"""Anthropic Claude provider."""

from __future__ import annotations

import os
from typing import Any, AsyncIterator

from .base import Event, LLMProvider, Message, Tool, ToolCall


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider using the official SDK."""

    DEFAULT_MODEL = "claude-opus-4-5-20251101"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        """Initialize the Anthropic provider.

        Args:
            model: Model to use (default: claude-opus-4-20250514)
            api_key: API key (default: from ANTHROPIC_API_KEY env var)
        """
        try:
            import anthropic
        except ImportError:
            raise ImportError("anthropic package required. Install with: pip install anthropic")

        self._model = model or os.environ.get("ANTHROPIC_MODEL", self.DEFAULT_MODEL)
        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")

        if not self._api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable not set")

        self._client = anthropic.AsyncAnthropic(api_key=self._api_key)

    @property
    def name(self) -> str:
        return "anthropic"

    @property
    def model(self) -> str:
        return self._model

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        """Convert our messages to Anthropic format."""
        result = []
        for msg in messages:
            if msg.role == "system":
                # System messages handled separately in Anthropic
                continue
            elif msg.role == "tool":
                # Tool results in Anthropic format
                result.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id,
                        "content": msg.content,
                    }],
                })
            elif msg.role == "assistant" and msg.tool_calls:
                # Assistant message with tool calls
                content = []
                if msg.content:
                    content.append({"type": "text", "text": msg.content})
                for tc in msg.tool_calls:
                    content.append({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    })
                result.append({"role": "assistant", "content": content})
            else:
                result.append({"role": msg.role, "content": msg.content})
        return result

    def _convert_tools(self, tools: list[Tool]) -> list[dict[str, Any]]:
        """Convert tools to Anthropic format."""
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            }
            for tool in tools
        ]

    async def chat(
        self,
        messages: list[Message],
        tools: list[Tool] | None = None,
        system: str | None = None,
    ) -> AsyncIterator[Event]:
        """Stream a chat completion."""
        import anthropic

        # Extract system message if present
        system_prompt = system
        for msg in messages:
            if msg.role == "system":
                system_prompt = msg.content
                break

        # Build request
        request_params: dict[str, Any] = {
            "model": self._model,
            "max_tokens": 4096,
            "messages": self._convert_messages(messages),
        }

        if system_prompt:
            request_params["system"] = system_prompt

        if tools:
            request_params["tools"] = self._convert_tools(tools)

        try:
            async with self._client.messages.stream(**request_params) as stream:
                current_tool_call: dict[str, Any] | None = None

                async for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "tool_use":
                            current_tool_call = {
                                "id": block.id,
                                "name": block.name,
                                "arguments_json": "",
                            }

                    elif event.type == "content_block_delta":
                        delta = event.delta
                        if delta.type == "text_delta":
                            yield Event(type="text_delta", text=delta.text)
                        elif delta.type == "input_json_delta":
                            if current_tool_call:
                                current_tool_call["arguments_json"] += delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_call:
                            import json
                            try:
                                args = json.loads(current_tool_call["arguments_json"])
                            except json.JSONDecodeError:
                                args = {}
                            yield Event(
                                type="tool_call",
                                tool_call=ToolCall(
                                    id=current_tool_call["id"],
                                    name=current_tool_call["name"],
                                    arguments=args,
                                ),
                            )
                            current_tool_call = None

                yield Event(type="done")

        except anthropic.APIError as e:
            yield Event(type="error", error=f"Anthropic API error: {e}")
