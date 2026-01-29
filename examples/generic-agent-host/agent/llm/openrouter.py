"""OpenRouter provider (OpenAI-compatible API)."""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator

import httpx

from .base import Event, LLMProvider, Message, Tool, ToolCall


class OpenRouterProvider(LLMProvider):
    """OpenRouter provider using their OpenAI-compatible API."""

    API_BASE = "https://openrouter.ai/api/v1"
    DEFAULT_MODEL = "anthropic/claude-3.5-sonnet"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        """Initialize the OpenRouter provider.

        Args:
            model: Model to use (default: from MODEL_NAME env var or claude-3.5-sonnet)
            api_key: API key (default: from OPENROUTER_API_KEY env var)
        """
        self._model = model or os.environ.get("MODEL_NAME", self.DEFAULT_MODEL)
        self._api_key = api_key or os.environ.get("OPENROUTER_API_KEY")

        if not self._api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable not set")

        self._client = httpx.AsyncClient(
            base_url=self.API_BASE,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "HTTP-Referer": "https://github.com/modelcontextprotocol/ext-apps",
                "X-Title": "ADK Analytics Agent",
            },
            timeout=60.0,
        )

    @property
    def name(self) -> str:
        return "openrouter"

    @property
    def model(self) -> str:
        return self._model

    def _convert_messages(self, messages: list[Message], system: str | None) -> list[dict[str, Any]]:
        """Convert our messages to OpenAI format."""
        result = []

        if system:
            result.append({"role": "system", "content": system})

        for msg in messages:
            if msg.role == "system":
                # Already handled above
                continue
            elif msg.role == "tool":
                result.append({
                    "role": "tool",
                    "tool_call_id": msg.tool_call_id,
                    "content": msg.content,
                })
            elif msg.role == "assistant" and msg.tool_calls:
                tool_calls = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": json.dumps(tc.arguments),
                        },
                    }
                    for tc in msg.tool_calls
                ]
                result.append({
                    "role": "assistant",
                    "content": msg.content or None,
                    "tool_calls": tool_calls,
                })
            else:
                result.append({"role": msg.role, "content": msg.content})

        return result

    def _convert_tools(self, tools: list[Tool]) -> list[dict[str, Any]]:
        """Convert tools to OpenAI function format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
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
        request_body: dict[str, Any] = {
            "model": self._model,
            "messages": self._convert_messages(messages, system),
            "stream": True,
        }

        if tools:
            request_body["tools"] = self._convert_tools(tools)

        try:
            async with self._client.stream(
                "POST",
                "/chat/completions",
                json=request_body,
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    yield Event(type="error", error=f"OpenRouter error {response.status_code}: {error_text.decode()}")
                    return

                current_tool_calls: dict[int, dict[str, Any]] = {}

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data = line[6:]
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})

                    # Handle text content
                    if content := delta.get("content"):
                        yield Event(type="text_delta", text=content)

                    # Handle tool calls
                    if tool_calls := delta.get("tool_calls"):
                        for tc in tool_calls:
                            idx = tc.get("index", 0)
                            if idx not in current_tool_calls:
                                current_tool_calls[idx] = {
                                    "id": tc.get("id", ""),
                                    "name": "",
                                    "arguments": "",
                                }
                            if tc.get("id"):
                                current_tool_calls[idx]["id"] = tc["id"]
                            if func := tc.get("function"):
                                if func.get("name"):
                                    current_tool_calls[idx]["name"] = func["name"]
                                if func.get("arguments"):
                                    current_tool_calls[idx]["arguments"] += func["arguments"]

                    # Check for finish reason
                    if choices[0].get("finish_reason") == "tool_calls":
                        for tc_data in current_tool_calls.values():
                            try:
                                args = json.loads(tc_data["arguments"])
                            except json.JSONDecodeError:
                                args = {}
                            yield Event(
                                type="tool_call",
                                tool_call=ToolCall(
                                    id=tc_data["id"],
                                    name=tc_data["name"],
                                    arguments=args,
                                ),
                            )

                yield Event(type="done")

        except httpx.HTTPError as e:
            yield Event(type="error", error=f"HTTP error: {e}")
