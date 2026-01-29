"""Google Gemini provider."""

from __future__ import annotations

import os
from typing import Any, AsyncIterator

from .base import Event, LLMProvider, Message, Tool, ToolCall


class GoogleProvider(LLMProvider):
    """Google Gemini provider using the official SDK."""

    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(self, model: str | None = None, api_key: str | None = None):
        """Initialize the Google provider.

        Args:
            model: Model to use (default: gemini-2.0-flash)
            api_key: API key (default: from GOOGLE_API_KEY env var)
        """
        try:
            from google import genai
        except ImportError:
            raise ImportError("google-genai package required. Install with: pip install google-genai")

        self._model = model or os.environ.get("GOOGLE_MODEL", self.DEFAULT_MODEL)
        self._api_key = api_key or os.environ.get("GOOGLE_API_KEY")

        if not self._api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set")

        self._client = genai.Client(api_key=self._api_key)

    @property
    def name(self) -> str:
        return "google"

    @property
    def model(self) -> str:
        return self._model

    def _convert_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        """Convert our messages to Gemini format."""
        from google.genai import types

        result = []
        for msg in messages:
            if msg.role == "system":
                # System messages handled separately
                continue
            elif msg.role == "tool":
                # Tool results
                result.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_function_response(
                                name=msg.tool_call_id or "unknown",
                                response={"result": msg.content},
                            )
                        ],
                    )
                )
            elif msg.role == "assistant" and msg.tool_calls:
                # Assistant with tool calls
                parts = []
                if msg.content:
                    parts.append(types.Part(text=msg.content))
                for tc in msg.tool_calls:
                    parts.append(
                        types.Part.from_function_call(
                            name=tc.name,
                            args=tc.arguments,
                        )
                    )
                result.append(types.Content(role="model", parts=parts))
            elif msg.role == "assistant":
                result.append(
                    types.Content(role="model", parts=[types.Part(text=msg.content)])
                )
            else:
                result.append(
                    types.Content(role="user", parts=[types.Part(text=msg.content)])
                )
        return result

    def _convert_tools(self, tools: list[Tool]) -> list[Any]:
        """Convert tools to Gemini format."""
        from google.genai import types

        declarations = []
        for tool in tools:
            declarations.append(
                types.FunctionDeclaration(
                    name=tool.name,
                    description=tool.description,
                    parameters=tool.parameters,
                )
            )
        return [types.Tool(function_declarations=declarations)]

    async def chat(
        self,
        messages: list[Message],
        tools: list[Tool] | None = None,
        system: str | None = None,
    ) -> AsyncIterator[Event]:
        """Stream a chat completion."""
        from google.genai import types

        # Extract system message
        system_prompt = system
        for msg in messages:
            if msg.role == "system":
                system_prompt = msg.content
                break

        # Build config
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
        )
        if tools:
            config.tools = self._convert_tools(tools)

        contents = self._convert_messages(messages)

        try:
            # Use streaming
            async for chunk in await self._client.aio.models.generate_content_stream(
                model=self._model,
                contents=contents,
                config=config,
            ):
                if not chunk.candidates:
                    continue

                candidate = chunk.candidates[0]
                if not candidate.content or not candidate.content.parts:
                    continue

                for part in candidate.content.parts:
                    if hasattr(part, "text") and part.text:
                        yield Event(type="text_delta", text=part.text)
                    elif hasattr(part, "function_call") and part.function_call:
                        fc = part.function_call
                        yield Event(
                            type="tool_call",
                            tool_call=ToolCall(
                                id=fc.name,  # Gemini uses name as ID
                                name=fc.name,
                                arguments=dict(fc.args) if fc.args else {},
                            ),
                        )

            yield Event(type="done")

        except Exception as e:
            yield Event(type="error", error=f"Google API error: {e}")
