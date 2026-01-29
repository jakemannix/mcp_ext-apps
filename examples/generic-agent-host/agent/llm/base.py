"""Base classes and types for LLM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal


@dataclass
class Message:
    """A message in the conversation."""

    role: Literal["user", "assistant", "system", "tool"]
    content: str
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] | None = None


@dataclass
class ToolCall:
    """A tool call requested by the LLM."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    """Result of a tool execution."""

    tool_call_id: str
    content: str
    structured_content: dict[str, Any] | None = None


@dataclass
class Tool:
    """Tool definition for the LLM."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema


@dataclass
class Event:
    """Event yielded during streaming."""

    type: Literal["text_delta", "tool_call", "tool_result", "done", "error"]
    text: str | None = None
    tool_call: ToolCall | None = None
    tool_result: ToolResult | None = None
    error: str | None = None


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging."""
        pass

    @property
    @abstractmethod
    def model(self) -> str:
        """Model identifier being used."""
        pass

    @abstractmethod
    async def chat(
        self,
        messages: list[Message],
        tools: list[Tool] | None = None,
        system: str | None = None,
    ) -> AsyncIterator[Event]:
        """Stream a chat completion with optional tool use.

        Args:
            messages: Conversation history
            tools: Available tools (optional)
            system: System prompt (optional)

        Yields:
            Events: text_delta, tool_call, done, or error
        """
        pass

    def _convert_tool_to_schema(self, tool: Tool) -> dict[str, Any]:
        """Convert our Tool to provider-specific format. Override in subclasses."""
        return {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
