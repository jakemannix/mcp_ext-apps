"""Generic ReAct agent loop with MCP Apps support."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .llm import LLMProvider, Message, ToolCall
from .mcp_client import MCPClient, ToolResult

logger = logging.getLogger(__name__)

# Generic system prompt - apps can customize via context
SYSTEM_PROMPT = """You are a helpful assistant with access to tools.

When the user asks you to do something:
1. Use the available tools to accomplish the task
2. Explain what you're doing and why
3. Be concise but thorough

When you receive context updates from the app, use that information to guide your actions.
When the app sends you a message (appearing as an assistant turn), continue from there
by calling the appropriate tools based on the context provided."""


@dataclass
class AgentEvent:
    """Event emitted by the agent during execution."""

    type: str  # "text", "tool_call", "tool_result", "structured_content", "done", "error"
    text: str | None = None
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_result: str | None = None
    structured_content: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class Agent:
    """ReAct agent that uses an LLM to interact with MCP tools."""

    llm: LLMProvider
    mcp_client: MCPClient
    max_turns: int = 10
    history: list[Message] = field(default_factory=list)
    model_context: str | None = None  # Latest context from app

    async def chat(self, user_message: str) -> AsyncIterator[AgentEvent]:
        """Process a user message and yield events."""
        # Add user message to history
        self.history.append(Message(role="user", content=user_message))

        async for event in self._run_agent_loop():
            yield event

    async def inject_assistant_message(self, content: str) -> AsyncIterator[AgentEvent]:
        """Inject an assistant message (from ui/message with role=assistant) and continue.

        This is used when the MCP App sends a message with role="assistant".
        We add it to history and continue the agent loop to call tools.
        """
        logger.info(f"Injecting assistant message: {content[:100]}...")

        # Add as assistant message to history
        self.history.append(Message(role="assistant", content=content))

        # Continue agent loop - LLM will see the assistant message and may call tools
        async for event in self._run_agent_loop():
            yield event

    async def _run_agent_loop(self) -> AsyncIterator[AgentEvent]:
        """Core agent loop - get LLM response, execute tools, repeat."""
        # Get available tools
        tools = await self.mcp_client.get_tools()
        logger.info(f"Agent has {len(tools)} tools available")

        # Build system prompt with any model context from the app
        system = SYSTEM_PROMPT
        if self.model_context:
            system = f"{SYSTEM_PROMPT}\n\n## Current App Context\n{self.model_context}"

        turns = 0
        while turns < self.max_turns:
            turns += 1
            logger.debug(f"Agent turn {turns}/{self.max_turns}")

            # Collect response from LLM
            accumulated_text = ""
            tool_calls: list[ToolCall] = []

            async for event in self.llm.chat(
                messages=self.history,
                tools=tools,
                system=system,
            ):
                if event.type == "text_delta" and event.text:
                    accumulated_text += event.text
                    yield AgentEvent(type="text", text=event.text)

                elif event.type == "tool_call" and event.tool_call:
                    tool_calls.append(event.tool_call)
                    yield AgentEvent(
                        type="tool_call",
                        tool_name=event.tool_call.name,
                        tool_args=event.tool_call.arguments,
                    )

                elif event.type == "error":
                    yield AgentEvent(type="error", error=event.error)
                    return

            # Add assistant message to history
            if accumulated_text or tool_calls:
                self.history.append(
                    Message(
                        role="assistant",
                        content=accumulated_text,
                        tool_calls=tool_calls if tool_calls else None,
                    )
                )

            # If no tool calls, we're done
            if not tool_calls:
                logger.info("Agent finished (no more tool calls)")
                yield AgentEvent(type="done")
                return

            # Execute tool calls
            for tc in tool_calls:
                logger.info(f"Executing tool: {tc.name}")
                try:
                    result = await self.mcp_client.call_tool(tc.name, tc.arguments)

                    # Yield tool result event
                    yield AgentEvent(
                        type="tool_result",
                        tool_name=tc.name,
                        tool_result=result.content,
                    )

                    # If there's structured content, yield it separately for the UI
                    if result.structured_content:
                        logger.info(f"Yielding structured content with keys: {list(result.structured_content.keys())}")
                        yield AgentEvent(
                            type="structured_content",
                            structured_content=result.structured_content,
                        )
                    else:
                        logger.warning("Tool result has no structured content")

                    # Add tool result to history
                    self.history.append(
                        Message(
                            role="tool",
                            content=result.content,
                            tool_call_id=tc.id,
                        )
                    )

                except Exception as e:
                    error_msg = f"Tool error: {e}"
                    logger.error(error_msg)
                    yield AgentEvent(type="error", error=error_msg)

                    # Add error as tool result so LLM knows it failed
                    self.history.append(
                        Message(
                            role="tool",
                            content=f"Error: {e}",
                            tool_call_id=tc.id,
                        )
                    )

        # Hit max turns
        logger.warning(f"Agent hit max turns ({self.max_turns})")
        yield AgentEvent(
            type="error",
            error=f"Reached maximum number of turns ({self.max_turns})",
        )

    def update_model_context(self, context: str | None) -> None:
        """Update the model context from the app."""
        self.model_context = context
        logger.info(f"Model context updated: {context[:100] if context else 'cleared'}...")

    def clear_history(self) -> None:
        """Clear conversation history."""
        self.history.clear()
        self.model_context = None
        logger.info("Agent history cleared")
