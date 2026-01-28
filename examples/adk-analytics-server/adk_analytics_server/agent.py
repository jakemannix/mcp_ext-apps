"""ReAct agent loop for LLM-powered analytics."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .llm import LLMProvider, Message, Event as LLMEvent, ToolCall
from .mcp_client import MCPClient, ToolResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert financial analyst assistant with access to real-time market data and technical analysis tools.

Your capabilities:
- Analyze stock portfolios with current market data
- Perform technical analysis (RSI, MACD, Bollinger Bands)
- Provide AI-powered insights on market conditions
- Generate visualizations of stock data

When users ask about stocks or market data:
1. Use the available tools to fetch real data
2. Explain what the data shows in clear, accessible terms
3. Provide actionable insights when appropriate

Always use real data from the tools - never make up prices or statistics.
Be concise but thorough in your analysis.

IMPORTANT: Format your responses using HTML tags, not markdown. Use:
- <h2>, <h3> for headings (not ## or ###)
- <strong> or <b> for bold (not **)
- <em> or <i> for italics (not *)
- <ul><li> for bullet lists (not - or *)
- <ol><li> for numbered lists
- <code> for inline code
- <br> for line breaks within paragraphs
- <p> for paragraphs"""


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

    async def chat(self, user_message: str) -> AsyncIterator[AgentEvent]:
        """Process a user message and yield events.

        Args:
            user_message: The user's input

        Yields:
            AgentEvent objects representing agent actions and responses
        """
        # Add user message to history
        self.history.append(Message(role="user", content=user_message))

        # Get available tools
        tools = await self.mcp_client.get_tools()
        logger.info(f"Agent has {len(tools)} tools available")

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
                system=SYSTEM_PROMPT,
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
                        yield AgentEvent(
                            type="structured_content",
                            structured_content=result.structured_content,
                        )

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

    def clear_history(self) -> None:
        """Clear conversation history."""
        self.history.clear()
        logger.info("Agent history cleared")
