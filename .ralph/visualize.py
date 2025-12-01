#!/usr/bin/env python3
"""Visualize JSONL stream from stdin with colors and formatting."""

import io
import json
import sys
from typing import Any

from rich.console import Console
from rich.style import Style
from rich.text import Text

# Force UTF-8 encoding for stdin/stdout on Windows
if sys.platform == "win32":
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

console = Console(force_terminal=True)

# Color styles matching the TypeScript version
colors = {
    "reset": Style(),
    "bright": Style(bold=True),
    "dim": Style(dim=True),
    "red": Style(color="red"),
    "green": Style(color="green"),
    "yellow": Style(color="yellow"),
    "blue": Style(color="blue"),
    "magenta": Style(color="magenta"),
    "cyan": Style(color="cyan"),
}


def get_type_color(type_str: str) -> Style:
    """Get the appropriate color style for a message type."""
    type_colors = {
        "system": colors["magenta"],
        "user": colors["blue"],
        "assistant": colors["green"],
        "tool_use": colors["cyan"],
        "tool_result": colors["yellow"],
        "message": colors["dim"],
        "text": colors["reset"],
    }
    return type_colors.get(type_str, colors["reset"])


def format_todo_list(todos: list[dict[str, Any]]) -> None:
    """Format a todo list with colors and progress tracking."""
    console.print("📋 ", end="")
    console.print("Todo List Update", style=colors["bright"] + colors["cyan"])

    status_colors = {
        "completed": colors["dim"] + colors["green"],
        "in_progress": colors["bright"] + colors["yellow"],
        "pending": colors["reset"],
    }

    status_icons = {
        "completed": "✅",
        "in_progress": "🔄",
        "pending": "⏸️",
    }

    priority_colors = {
        "high": colors["red"],
        "medium": colors["yellow"],
        "low": colors["dim"],
    }

    for todo in todos:
        status = todo.get("status", "pending")
        status_color = status_colors.get(status, colors["reset"])
        status_icon = status_icons.get(status, "❓")
        priority = todo.get("priority", "medium")
        priority_color = priority_colors.get(priority, colors["reset"])
        checkbox = "☑️" if status == "completed" else "☐"

        line = Text()
        line.append(f"  {checkbox} {status_icon} ")
        line.append(todo.get("content", ""), style=status_color)
        line.append(f" [{priority}]", style=priority_color)

        if status == "in_progress":
            line.append(" ← ACTIVE", style=colors["bright"] + colors["yellow"])

        console.print(line)

    # Add summary stats
    completed = sum(1 for t in todos if t.get("status") == "completed")
    in_progress = sum(1 for t in todos if t.get("status") == "in_progress")
    pending = sum(1 for t in todos if t.get("status") == "pending")
    total = len(todos)
    progress_pct = round((completed / total) * 100) if total > 0 else 0

    console.print("\n  ", end="")
    console.print("📊 Progress: ", style=colors["dim"], end="")
    console.print(f"{completed} completed", style=colors["green"], end="")
    console.print(", ", style=colors["dim"], end="")
    console.print(f"{in_progress} active", style=colors["yellow"], end="")
    console.print(", ", style=colors["dim"], end="")
    console.print(f"{pending} pending", style=colors["reset"], end="")
    console.print(f" ({progress_pct}% done)", style=colors["dim"])


def safe_str(value: Any, max_len: int | None = None) -> str:
    """Safely convert any value to string and optionally truncate."""
    result = str(value) if not isinstance(value, str) else value
    if max_len is not None and len(result) > max_len:
        return result[:max_len]
    return result


def format_concise(json_data: dict[str, Any]) -> None:
    """Format a JSON message in concise mode."""
    msg_type = json_data.get("type", "unknown")
    type_color = get_type_color(msg_type)

    # Special handling for TodoWrite calls
    if (
        msg_type == "assistant"
        and json_data.get("message", {}).get("content", [{}])[0].get("name")
        == "TodoWrite"
    ):
        tool_input = json_data["message"]["content"][0].get("input", {})
        if "todos" in tool_input and isinstance(tool_input["todos"], list):
            format_todo_list(tool_input["todos"])
            return

    # Add context based on type - tool calls
    if msg_type == "assistant" and json_data.get("message", {}).get("content"):
        content = json_data["message"]["content"]
        if content and content[0].get("name"):
            tool_name = content[0]["name"]
            tool_input = content[0].get("input", {})

            # Format tool name with key arguments
            console.print("⏺ ", end="")
            console.print(tool_name, style=colors["cyan"], end="")

            if tool_input:
                key_args = []

                # Extract the most important argument for each tool type
                if "file_path" in tool_input:
                    key_args.append(safe_str(tool_input["file_path"]))
                elif "path" in tool_input:
                    key_args.append(safe_str(tool_input["path"]))
                elif "pattern" in tool_input:
                    key_args.append(f'"{safe_str(tool_input["pattern"])}"')
                elif "command" in tool_input:
                    key_args.append(safe_str(tool_input["command"]))
                elif "cmd" in tool_input:
                    key_args.append(safe_str(tool_input["cmd"]))
                elif "query" in tool_input:
                    key_args.append(f'"{safe_str(tool_input["query"])}"')
                elif "description" in tool_input:
                    key_args.append(safe_str(tool_input["description"]))
                elif "prompt" in tool_input:
                    key_args.append(f'"{safe_str(tool_input["prompt"], 30)}..."')
                elif "url" in tool_input:
                    key_args.append(safe_str(tool_input["url"]))

                if key_args:
                    console.print("(", end="")
                    console.print(
                        key_args[0], style=colors["green"], end="", markup=False
                    )
                    console.print(")", end="")

            # Show additional arguments on next lines for complex tools
            if tool_input:
                additional_args = []

                if tool_name == "Bash" and "cwd" in tool_input:
                    additional_args.append(f"cwd: {safe_str(tool_input['cwd'])}")
                if "limit" in tool_input:
                    additional_args.append(f"limit: {tool_input['limit']}")
                if "offset" in tool_input:
                    additional_args.append(f"offset: {tool_input['offset']}")
                if "include" in tool_input:
                    additional_args.append(f"include: {tool_input['include']}")
                if "old_string" in tool_input and "new_string" in tool_input:
                    old_str = safe_str(tool_input["old_string"], 20)
                    new_str = safe_str(tool_input["new_string"], 20)
                    additional_args.append(f'replace: "{old_str}..." → "{new_str}..."')
                if "timeout" in tool_input:
                    additional_args.append(f"timeout: {tool_input['timeout']}ms")

                if additional_args:
                    console.print()
                    console.print("  ⎿  ", end="")
                    console.print(
                        ", ".join(additional_args), style=colors["dim"], markup=False
                    )
            return

    # Print the type indicator for non-tool messages
    console.print("⏺ ", end="")
    console.print(msg_type.capitalize(), style=type_color, end="")

    if msg_type == "tool_result" and "name" in json_data:
        console.print("(", end="")
        console.print(json_data["name"], style=colors["cyan"], end="")
        console.print(")", end="")

    elif msg_type == "user" and json_data.get("message", {}).get("content"):
        content = json_data["message"]["content"]
        if content and content[0].get("type") == "tool_result":
            # Override the type display for tool results
            console.print("\r⏺ ", end="")
            console.print("Tool Result", style=colors["yellow"], end="")

            # Show result summary and first 2 lines
            tool_content = content[0].get("content")
            if tool_content:
                result_text = (
                    tool_content
                    if isinstance(tool_content, str)
                    else json.dumps(tool_content)
                )
                lines = result_text.split("\n")
                chars = len(result_text)
                console.print()
                console.print("  ⎿  ", end="")
                console.print(
                    f"{len(lines)} lines, {chars} chars", style=colors["dim"], end=""
                )
                if content[0].get("is_error"):
                    console.print(" ERROR", style=colors["red"], end="")

                # Show first 2 lines of content
                if lines and lines[0].strip():
                    console.print()
                    console.print("  ⎿  ", end="")
                    console.print(lines[0], style=colors["reset"], markup=False)
                if len(lines) > 1 and lines[1].strip():
                    console.print("      ", end="")
                    console.print(lines[1], style=colors["dim"], markup=False)
            return

        if content and content[0].get("text"):
            text = safe_str(content[0]["text"], 50)
            console.print(": ", end="")
            console.print(text, style=colors["dim"], end="", markup=False)
            if len(safe_str(content[0]["text"])) > 50:
                console.print("...", style=colors["dim"], end="")

    elif msg_type == "system" and "subtype" in json_data:
        console.print("(", end="")
        console.print(json_data["subtype"], style=colors["dim"], end="")
        console.print(")", end="")

    # Show assistant message content if it exists
    if msg_type == "assistant" and json_data.get("message", {}).get("content"):
        content_items = json_data["message"]["content"]
        text_content = next((c for c in content_items if c.get("type") == "text"), None)
        if text_content and text_content.get("text"):
            lines = safe_str(text_content["text"]).split("\n")[:3]  # Show first 3 lines
            console.print()
            console.print("  ⎿  ", end="")
            console.print(lines[0], style=colors["reset"], markup=False)
            if len(lines) > 1:
                console.print("      ", end="")
                console.print(lines[1], style=colors["dim"], markup=False)
            if len(lines) > 2:
                console.print("      ", end="")
                console.print(lines[2], style=colors["dim"], markup=False)
            if len(safe_str(text_content["text"]).split("\n")) > 3:
                console.print("      ", end="")
                console.print("...", style=colors["dim"])

    # Add summary line
    summary = ""
    if json_data.get("message", {}).get("usage"):
        usage = json_data["message"]["usage"]
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        summary = f"{input_tokens}/{output_tokens} tokens"
    elif "output" in json_data and isinstance(json_data["output"], str):
        summary = f"{len(json_data['output'])} chars output"
    elif json_data.get("message", {}).get("content"):
        summary = f"{len(json_data['message']['content'])} content items"
    elif "tools" in json_data:
        summary = f"{len(json_data['tools'])} tools available"

    if summary:
        console.print()
        console.print("  ⎿  ", end="")
        console.print(summary, style=colors["dim"])

    console.print()


def display_tool_call_with_result(
    tool_call: dict[str, Any],
    tool_call_json: dict[str, Any],
    tool_result_json: dict[str, Any],
    call_timestamp: str,
    result_timestamp: str,
) -> None:
    """Display a tool call paired with its result."""
    # Display the tool call header
    console.print(call_timestamp, end="")
    format_concise(tool_call_json)

    # Display the result
    tool_result = tool_result_json["message"]["content"][0]
    is_error = tool_result.get("is_error", False)
    result_icon = "❌" if is_error else "✅"
    result_color = colors["red"] if is_error else colors["green"]

    console.print("  ", end="")
    console.print(result_timestamp, end="")
    console.print(result_icon, end=" ")
    console.print("Tool Result", style=result_color, end="")

    if "content" in tool_result:
        result_text = (
            tool_result["content"]
            if isinstance(tool_result["content"], str)
            else json.dumps(tool_result["content"])
        )
        lines = result_text.split("\n")
        chars = len(result_text)

        console.print(" ", end="")
        console.print(
            f"({len(lines)} lines, {chars} chars)", style=colors["dim"], end=""
        )

        if is_error:
            console.print(" ERROR", style=colors["red"], end="")

        # Show first few lines of result
        lines_to_show = min(3, len(lines))
        for i in range(lines_to_show):
            if lines[i].strip():
                line_color = colors["reset"] if i == 0 else colors["dim"]
                console.print()
                console.print("    ⎿  ", end="")
                console.print(lines[i], style=line_color, end="", markup=False)

        if len(lines) > lines_to_show:
            console.print()
            console.print("    ⎿  ", end="")
            console.print(
                f"... {len(lines) - lines_to_show} more lines",
                style=colors["dim"],
                end="",
            )

    console.print("\n")


def process_stream() -> None:
    """Process JSONL stream from stdin."""
    debug_mode = "--debug" in sys.argv
    tool_calls: dict[str, dict[str, Any]] = {}  # Store tool calls by their ID
    pending_results: dict[
        str, dict[str, Any]
    ] = {}  # Store results waiting for their tool calls
    last_line: dict[str, Any] | None = (
        None  # Track the last line to detect final message
    )
    is_last_assistant_message = False

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        timestamp = ""
        if debug_mode:
            from datetime import datetime, timezone

            timestamp = console.render_str(
                f"[{datetime.now(timezone.utc).isoformat()}] ", style=colors["dim"]
            )

        try:
            json_data = json.loads(line)

            # Check if this is a tool call
            content = json_data.get("message", {}).get("content", [])
            if json_data.get("type") == "assistant" and content and "id" in content[0]:
                tool_call = content[0]
                tool_id = tool_call["id"]

                # Store the tool call
                tool_calls[tool_id] = {
                    "tool_call": json_data,
                    "timestamp": timestamp,
                }

                # Check if we have a pending result for this tool call
                if tool_id in pending_results:
                    result = pending_results[tool_id]
                    display_tool_call_with_result(
                        tool_call,
                        json_data,
                        result["tool_result"],
                        timestamp,  # type: ignore
                        result["timestamp"],
                    )
                    del pending_results[tool_id]
                else:
                    # Display the tool call and mark it as pending
                    console.print(timestamp, end="")
                    format_concise(json_data)
                    console.print("  ⎿  Waiting for result...", style=colors["dim"])
                    console.print()

            # Check if this is a tool result
            elif json_data.get("type") == "user" and json_data.get("message", {}).get(
                "content"
            ):
                content = json_data["message"]["content"]
                if content and content[0].get("type") == "tool_result":
                    tool_result = content[0]
                    tool_id = tool_result.get("tool_use_id")

                    if tool_id and tool_id in tool_calls:
                        # We have the matching tool call, display them together
                        stored = tool_calls[tool_id]
                        display_tool_call_with_result(
                            stored["tool_call"]["message"]["content"][0],
                            stored["tool_call"],
                            json_data,
                            stored["timestamp"],
                            timestamp,  # type: ignore
                        )
                        del tool_calls[tool_id]
                    else:
                        # Store the result and wait for the tool call
                        if tool_id:
                            pending_results[tool_id] = {
                                "tool_result": json_data,
                                "timestamp": timestamp,
                            }

            # Check if this is the result message and display full content
            elif json_data.get("type") == "result" and "result" in json_data:
                console.print(timestamp, end="")
                format_concise(json_data)
                console.print()
                console.print(
                    "=== Final Result ===", style=colors["bright"] + colors["green"]
                )
                console.print()
                console.print(json_data["result"], markup=False)

            # For all other message types, display normally
            else:
                console.print(timestamp, end="")
                format_concise(json_data)
                console.print()

            # Track if this might be the last assistant message
            last_line = json_data
            is_last_assistant_message = json_data.get(
                "type"
            ) == "assistant" and not json_data.get("message", {}).get("content", [{}])[
                0
            ].get("id")

        except json.JSONDecodeError:
            console.print(timestamp, end="")
            console.print("⏺ Parse Error", style=colors["red"])
            console.print(f"  ⎿  {line[:50]}...", style=colors["dim"], markup=False)
            console.print()

    # If the last message was an assistant message (not a tool call), display the full content
    if (
        is_last_assistant_message
        and last_line
        and last_line.get("message", {}).get("content")
    ):
        content = last_line["message"]["content"]
        if content and content[0].get("text"):
            console.print()
            console.print(
                "=== Final Assistant Message ===",
                style=colors["bright"] + colors["green"],
            )
            console.print()
            console.print(content[0]["text"], markup=False)


if __name__ == "__main__":
    try:
        process_stream()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        console.print(f"Error: {e}", style=colors["red"], markup=False)
        sys.exit(1)
