# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is the **Superpowers Plugin** (v4.3.1) — a composable AI agent skills library for Claude Code, Cursor, Codex, and OpenCode. It implements a structured software development workflow through markdown-based "skills" enforced via hard gates, checklists, and flowcharts.

**Author**: Jesse Vincent | **License**: MIT | **Upstream**: https://github.com/obra/superpowers

The `.agents/superpowers/` directory is a git submodule (tracked upstream); local customizations live outside it.

## Key Directories

- `.agents/superpowers/skills/` — 14 core skill definitions (each as `SKILL.md`)
- `.agents/superpowers/hooks/` — SessionStart hook that injects skill context into each session
- `.agents/superpowers/commands/` — Slash commands (`/brainstorm`, `/write-plan`, `/execute-plan`)
- `.agents/superpowers/agents/` — Agent definitions (e.g., `code-reviewer.md`)
- `.agents/superpowers/tests/` — Test suites for skill triggering and integration
- `Research/` — Exploration of Claude's programmatic tool calling API

## Skills Architecture

Skills are markdown files with YAML frontmatter (`name`, `description`) and body instructions. The `using-superpowers` skill enforces that **all relevant skills must be invoked before responding** — this is the root rule of the system.

Key patterns in skills:
- `<HARD-GATE>` directives block progression until user confirms
- Graphviz DOT diagrams define process flows as executable specs
- `TodoWrite` checklists track multi-step execution
- Two-stage code review: spec compliance first, then quality

## Hook System

`hooks/hooks.json` registers a `SessionStart` hook (synchronous) that runs `run-hook.cmd session-start`. The `run-hook.cmd` is a polyglot wrapper supporting Windows/Unix bash with multiple bash discovery paths (Git Bash, WSL, cygwin, etc.).

The session-start script reads and injects skill context at session initialization.

## Plugin Manifests

- `.claude-plugin/plugin.json` — Claude Code plugin registration
- `.cursor-plugin/plugin.json` — Cursor plugin registration
- `.codex/` and `.opencode/` — Platform-specific setup for Codex and OpenCode

## Research Directory

`Research/programmatic_tool_client.py` is a production-ready Python client for Claude's programmatic tool calling API. It manages container lifecycle, tool registration via decorators, and the full agentic loop. `Research/examples.py` contains three runnable examples. Target model: `claude-opus-4-6`.

## Writing New Skills

Follow the `writing-skills/SKILL.md` guide (655 lines, most comprehensive). Key conventions:
- Skills live in `.agents/superpowers/skills/<skill-name>/SKILL.md`
- Include frontmatter with `name` and `description`
- Use hard gates to enforce mandatory checkpoints
- Reference `writing-skills/anthropic-best-practices.md` for prompt engineering patterns

## Line Endings

Shell scripts use LF (enforced by `.gitattributes`). On Windows, verify hook scripts haven't been converted to CRLF after editing.
