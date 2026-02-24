"""
Programmatic Tool Calling — Example Scripts
=============================================
Three complete, runnable examples demonstrating key patterns from the docs.

Prerequisites:
    pip install anthropic

Set your API key:
    export ANTHROPIC_API_KEY="sk-ant-..."
"""

import json
import asyncio
from programmatic_tool_client import ProgrammaticToolClient


# ═══════════════════════════════════════════════════════════════════════════
# Example 1: Basic — Single Tool, Programmatic Calling
# ═══════════════════════════════════════════════════════════════════════════

async def example_basic():
    """
    Simplest possible example: one tool, called programmatically by Claude.
    Claude writes Python to call query_database() and processes the result
    in code before returning a summary.
    """
    client = ProgrammaticToolClient()

    @client.tool(
        description=(
            "Execute a SQL query against the sales database. "
            "Returns a JSON array of row objects, e.g. "
            '[{"customer_id": "C1", "name": "Acme", "revenue": 45000}]'
        ),
        input_schema={
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query to execute"}
            },
            "required": ["sql"],
        },
        caller="code_execution",
    )
    async def query_database(sql: str) -> str:
        # Simulated database results
        fake_data = [
            {"customer_id": "C1", "name": "Acme Corp", "revenue": 45000, "orders": 23},
            {"customer_id": "C2", "name": "Globex", "revenue": 38000, "orders": 18},
            {"customer_id": "C3", "name": "Initech", "revenue": 24000, "orders": 12},
            {"customer_id": "C4", "name": "Umbrella", "revenue": 19000, "orders": 9},
            {"customer_id": "C5", "name": "Wonka", "revenue": 32000, "orders": 15},
            {"customer_id": "C6", "name": "Stark", "revenue": 28500, "orders": 14},
            {"customer_id": "C7", "name": "Wayne", "revenue": 15000, "orders": 7},
            {"customer_id": "C8", "name": "Oscorp", "revenue": 21000, "orders": 11},
        ]
        return json.dumps(fake_data)

    result = await client.run(
        "Query customer data and identify our top 3 customers by revenue."
    )
    print(f"\n{'='*60}")
    print(f"Final answer: {result.text}")
    print(f"Tool calls made: {result.tool_calls_made}")
    print(f"Tokens: {result.total_input_tokens} in / {result.total_output_tokens} out")


# ═══════════════════════════════════════════════════════════════════════════
# Example 2: Batch Processing — Loop Over Multiple Regions
# ═══════════════════════════════════════════════════════════════════════════

async def example_batch_processing():
    """
    Demonstrates the batch processing pattern: Claude writes a loop that
    calls the tool N times, aggregates results in code, and returns only
    the summary. This reduces N model round-trips to 1.
    """
    client = ProgrammaticToolClient()

    # Simulated per-region data
    region_data = {
        "West":    [{"product": "A", "revenue": 12000}, {"product": "B", "revenue": 8000}],
        "East":    [{"product": "A", "revenue": 15000}, {"product": "B", "revenue": 11000}],
        "Central": [{"product": "A", "revenue": 9000},  {"product": "B", "revenue": 7500}],
        "North":   [{"product": "A", "revenue": 6000},  {"product": "B", "revenue": 4500}],
        "South":   [{"product": "A", "revenue": 11000}, {"product": "B", "revenue": 9000}],
    }

    @client.tool(
        description=(
            "Query sales data for a specific region. "
            "Returns JSON array: [{\"product\": str, \"revenue\": int}, ...]"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "region": {"type": "string", "description": "Region name"}
            },
            "required": ["region"],
        },
        caller="code_execution",
    )
    async def get_region_sales(region: str) -> str:
        data = region_data.get(region, [])
        return json.dumps(data)

    result = await client.run(
        "Compare sales across all five regions (West, East, Central, North, South). "
        "Which region had the highest total revenue? Show a ranked breakdown."
    )
    print(f"\n{'='*60}")
    print(f"Final answer: {result.text}")
    print(f"Tool calls: {result.tool_calls_made} (5 regions, 1 model call)")


# ═══════════════════════════════════════════════════════════════════════════
# Example 3: Conditional Logic + Data Filtering
# ═══════════════════════════════════════════════════════════════════════════

async def example_conditional_filtering():
    """
    Demonstrates conditional tool selection and data filtering.
    Claude checks metadata first, then decides which tool to call,
    and filters results before returning them to its context.
    """
    client = ProgrammaticToolClient()

    @client.tool(
        description=(
            "Get metadata about a log file. "
            'Returns JSON: {"filename": str, "size_bytes": int, "line_count": int}'
        ),
        input_schema={
            "type": "object",
            "properties": {
                "server_id": {"type": "string", "description": "Server identifier"}
            },
            "required": ["server_id"],
        },
        caller="code_execution",
    )
    async def get_log_info(server_id: str) -> str:
        # Simulated metadata
        info = {
            "web-01": {"filename": "web-01.log", "size_bytes": 5200, "line_count": 45},
            "web-02": {"filename": "web-02.log", "size_bytes": 2500000, "line_count": 18000},
            "db-01":  {"filename": "db-01.log", "size_bytes": 800, "line_count": 12},
        }
        return json.dumps(info.get(server_id, {"error": "Server not found"}))

    @client.tool(
        description=(
            "Fetch full log contents for a server. "
            "Returns the complete log as a string, one entry per line."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "server_id": {"type": "string", "description": "Server identifier"}
            },
            "required": ["server_id"],
        },
        caller="code_execution",
    )
    async def fetch_logs(server_id: str) -> str:
        logs = {
            "web-01": "\n".join([
                "2025-01-15 10:00:01 INFO  Request /api/users 200 45ms",
                "2025-01-15 10:00:02 ERROR Connection pool exhausted",
                "2025-01-15 10:00:03 INFO  Request /api/orders 200 23ms",
                "2025-01-15 10:00:04 WARN  Slow query detected: 850ms",
                "2025-01-15 10:00:05 ERROR Database timeout after 30s",
                "2025-01-15 10:00:06 INFO  Request /api/products 200 12ms",
            ]),
            "db-01": "\n".join([
                "2025-01-15 10:00:01 INFO  Checkpoint complete",
                "2025-01-15 10:00:02 ERROR Replication lag: 15s",
                "2025-01-15 10:00:03 INFO  Vacuum started",
            ]),
        }
        return logs.get(server_id, "No logs found")

    @client.tool(
        description=(
            "Fetch a summary of a large log file. "
            'Returns JSON: {"errors": int, "warnings": int, "last_error": str}'
        ),
        input_schema={
            "type": "object",
            "properties": {
                "server_id": {"type": "string", "description": "Server identifier"}
            },
            "required": ["server_id"],
        },
        caller="code_execution",
    )
    async def fetch_log_summary(server_id: str) -> str:
        return json.dumps({
            "errors": 342,
            "warnings": 1205,
            "last_error": "2025-01-15 09:58:22 ERROR OOM killer invoked on pid 4521",
        })

    result = await client.run(
        "Check servers web-01, web-02, and db-01. For small log files, "
        "get the full logs and find errors. For large files, just get the summary. "
        "Report which servers need attention."
    )
    print(f"\n{'='*60}")
    print(f"Final answer: {result.text}")
    print(f"Tool calls: {result.tool_calls_made}")


# ═══════════════════════════════════════════════════════════════════════════
# Runner
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    examples = {
        "basic": example_basic,
        "batch": example_batch_processing,
        "conditional": example_conditional_filtering,
    }

    if len(sys.argv) > 1 and sys.argv[1] in examples:
        asyncio.run(examples[sys.argv[1]]())
    else:
        print("Programmatic Tool Calling Examples")
        print("=" * 40)
        print("Usage: python examples.py <example>")
        print()
        print("Available examples:")
        print("  basic        — Single tool, simple query + aggregate")
        print("  batch        — Loop over 5 regions, 1 model call")
        print("  conditional  — Check metadata → pick tool → filter results")
        print()
        print("Requires: pip install anthropic")
        print("          export ANTHROPIC_API_KEY='sk-ant-...'")
