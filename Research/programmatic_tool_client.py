"""
Programmatic Tool Calling — Reusable Client Library
=====================================================
A complete, production-ready helper for Claude's programmatic tool calling.
Handles the agentic loop, container reuse, timeouts, and error propagation.

Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling

Usage:
    from programmatic_tool_client import ProgrammaticToolClient

    client = ProgrammaticToolClient(api_key="sk-ant-...")

    # Register your tool handlers
    @client.tool(
        description="Execute SQL. Returns rows as JSON objects.",
        input_schema={...},
        caller="code_execution"  # programmatic only
    )
    async def query_database(sql: str) -> str:
        rows = await my_db.execute(sql)
        return json.dumps(rows)

    # Run a query — the client handles the full agentic loop
    result = await client.run("Find our top 5 customers by revenue")
    print(result.text)
"""

import json
import time
import asyncio
from dataclasses import dataclass, field
from typing import Callable, Any, Literal
from datetime import datetime, timezone

try:
    import anthropic
except ImportError:
    anthropic = None  # Allow reading the file without the SDK installed


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ToolDefinition:
    """Represents a registered tool with its handler and API schema."""
    name: str
    description: str
    input_schema: dict
    handler: Callable
    allowed_callers: list[str]


@dataclass
class RunResult:
    """The final result of a programmatic tool calling run."""
    text: str
    tool_calls_made: int = 0
    container_id: str | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    raw_messages: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class ProgrammaticToolClient:
    """
    High-level client for Claude's programmatic tool calling.

    Manages the full agentic loop:
    1. Send request with code_execution + your tools
    2. Detect tool_use blocks (direct or programmatic)
    3. Execute the matching handler
    4. Return tool_result and resume code execution
    5. Repeat until stop_reason is "end_turn"
    """

    MODEL = "claude-opus-4-6"
    CODE_EXECUTION_TOOL_TYPE = "code_execution_20260120"

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        max_tokens: int = 4096,
        timeout_buffer_seconds: int = 30,
    ):
        if anthropic is None:
            raise ImportError("pip install anthropic")
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model or self.MODEL
        self._max_tokens = max_tokens
        self._timeout_buffer = timeout_buffer_seconds
        self._tools: dict[str, ToolDefinition] = {}

    # -- Tool Registration ---------------------------------------------------

    def tool(
        self,
        description: str,
        input_schema: dict,
        caller: Literal["direct", "code_execution", "both"] = "code_execution",
        name: str | None = None,
    ):
        """
        Decorator to register a tool handler.

        Args:
            description: Detailed description of the tool's output format.
                         Be specific about JSON structure for best results.
            input_schema: JSON Schema for the tool's input parameters.
            caller: Who can invoke this tool:
                - "direct"         → only Claude directly (traditional)
                - "code_execution" → only from code execution (programmatic)
                - "both"           → either (not recommended per docs)
            name: Override the function name as the tool name.
        """
        caller_map = {
            "direct": ["direct"],
            "code_execution": [self.CODE_EXECUTION_TOOL_TYPE],
            "both": ["direct", self.CODE_EXECUTION_TOOL_TYPE],
        }

        def decorator(fn: Callable) -> Callable:
            tool_name = name or fn.__name__
            self._tools[tool_name] = ToolDefinition(
                name=tool_name,
                description=description,
                input_schema=input_schema,
                handler=fn,
                allowed_callers=caller_map[caller],
            )
            return fn

        return decorator

    # -- Build API Tool List -------------------------------------------------

    def _build_tools(self) -> list[dict]:
        """Build the tools array for the API request."""
        tools = [
            {"type": self.CODE_EXECUTION_TOOL_TYPE, "name": "code_execution"}
        ]
        for td in self._tools.values():
            tools.append({
                "name": td.name,
                "description": td.description,
                "input_schema": td.input_schema,
                "allowed_callers": td.allowed_callers,
            })
        return tools

    # -- Execute a Single Tool -----------------------------------------------

    async def _execute_tool(self, name: str, input_data: dict) -> str:
        """Execute a registered tool handler and return the result as a string."""
        if name not in self._tools:
            return f"Error: Unknown tool '{name}'"

        handler = self._tools[name].handler
        try:
            if asyncio.iscoroutinefunction(handler):
                result = await handler(**input_data)
            else:
                result = handler(**input_data)

            return result if isinstance(result, str) else json.dumps(result)
        except Exception as e:
            return f"Error: {type(e).__name__}: {e}"

    # -- Check Container Expiry ----------------------------------------------

    def _check_container_expiry(self, container: dict | None) -> None:
        """Warn if the container is close to expiring."""
        if not container or "expires_at" not in container:
            return
        expires = datetime.fromisoformat(
            container["expires_at"].replace("Z", "+00:00")
        )
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
        if remaining < self._timeout_buffer:
            print(
                f"⚠️  Container expires in {remaining:.0f}s — "
                f"respond quickly to avoid TimeoutError"
            )

    # -- Extract Tool Use Blocks ---------------------------------------------

    @staticmethod
    def _extract_tool_calls(content: list[dict]) -> list[dict]:
        """Extract all tool_use blocks from assistant content."""
        return [block for block in content if block.get("type") == "tool_use"]

    @staticmethod
    def _is_programmatic(tool_call: dict) -> bool:
        """Check if a tool call was made programmatically from code execution."""
        caller = tool_call.get("caller", {})
        return caller.get("type", "") != "direct"

    # -- Main Run Loop -------------------------------------------------------

    async def run(
        self,
        user_message: str,
        system: str | None = None,
        container_id: str | None = None,
    ) -> RunResult:
        """
        Run a full programmatic tool calling session.

        Handles the complete agentic loop:
        - Sends the initial request
        - Detects tool_use blocks (programmatic or direct)
        - Executes handlers and returns results
        - Loops until Claude says "end_turn"

        Args:
            user_message: The user's request.
            system: Optional system prompt.
            container_id: Reuse an existing container.

        Returns:
            RunResult with the final text and metadata.
        """
        messages = [{"role": "user", "content": user_message}]
        tools = self._build_tools()
        total_input = 0
        total_output = 0
        total_tool_calls = 0
        all_raw = []

        while True:
            # Build request kwargs
            kwargs = {
                "model": self._model,
                "max_tokens": self._max_tokens,
                "messages": messages,
                "tools": tools,
            }
            if system:
                kwargs["system"] = system
            if container_id:
                kwargs["container"] = container_id

            # Call the API
            response = self._client.messages.create(**kwargs)
            raw = response.model_dump()
            all_raw.append(raw)

            # Track usage
            usage = raw.get("usage", {})
            total_input += usage.get("input_tokens", 0)
            total_output += usage.get("output_tokens", 0)

            # Track container
            container = raw.get("container")
            if container:
                container_id = container.get("id", container_id)
                self._check_container_expiry(container)

            # Check stop reason
            stop_reason = raw.get("stop_reason", "")
            content = raw.get("content", [])

            if stop_reason == "end_turn":
                # Extract final text
                text_parts = [
                    block["text"]
                    for block in content
                    if block.get("type") == "text"
                ]
                return RunResult(
                    text="\n".join(text_parts),
                    tool_calls_made=total_tool_calls,
                    container_id=container_id,
                    total_input_tokens=total_input,
                    total_output_tokens=total_output,
                    raw_messages=all_raw,
                )

            if stop_reason == "tool_use":
                # Find all tool_use blocks
                tool_calls = self._extract_tool_calls(content)

                # Build tool results
                tool_results = []
                for tc in tool_calls:
                    total_tool_calls += 1
                    is_prog = self._is_programmatic(tc)
                    result_str = await self._execute_tool(
                        tc["name"], tc["input"]
                    )
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tc["id"],
                        "content": result_str,
                    })
                    src = "programmatic" if is_prog else "direct"
                    print(
                        f"  🔧 [{src}] {tc['name']}() → "
                        f"{result_str[:80]}{'...' if len(result_str) > 80 else ''}"
                    )

                # Append assistant turn + tool results
                # (full conversation history required by the API)
                messages.append({"role": "assistant", "content": content})

                # IMPORTANT: For programmatic tool calls, user message must
                # contain ONLY tool_result blocks — no text content allowed.
                messages.append({
                    "role": "user",
                    "content": tool_results,
                })
            else:
                # Unexpected stop reason — return what we have
                text_parts = [
                    block.get("text", "")
                    for block in content
                    if block.get("type") == "text"
                ]
                return RunResult(
                    text="\n".join(text_parts) or f"Unexpected stop: {stop_reason}",
                    tool_calls_made=total_tool_calls,
                    container_id=container_id,
                    total_input_tokens=total_input,
                    total_output_tokens=total_output,
                    raw_messages=all_raw,
                )


# ---------------------------------------------------------------------------
# Convenience — synchronous wrapper
# ---------------------------------------------------------------------------

def run_sync(client: ProgrammaticToolClient, user_message: str, **kwargs) -> RunResult:
    """Synchronous wrapper around client.run() for scripts."""
    return asyncio.run(client.run(user_message, **kwargs))
