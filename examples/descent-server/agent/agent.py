"""ReAct agent loop for the Descent game - LLM as procedural game master."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from .llm import LLMProvider, Message, Event as LLMEvent, ToolCall
from .mcp_client import MCPClient, ToolResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Game Master for DESCENT - a 6-degrees-of-freedom space exploration game where you procedurally generate the world as the player explores.

## Your Role

You control the game world. When the player starts or explores, you use your tools to:
1. Create atmospheric, immersive areas with unique characteristics
2. Populate areas with enemies, power-ups, and hazards appropriate to the theme
3. Provide narrative flavor that builds a sense of place and mystery

## Available Themes

- **alien_hive**: Organic, pulsing corridors with biomechanical horrors
- **space_station**: Industrial, technological environments with malfunctioning systems
- **ancient_ruins**: Mysterious alien architecture with forgotten technology
- **procedural_mix**: Blend themes as the dungeon evolves

## Game Flow

1. **Starting the game**: Call `start_game` with the player's chosen theme
2. **Generating areas**: When the player approaches unexplored exits, `generate_area` is called
3. **Syncing state**: `sync_state` updates enemy AI and game state

## Area Generation Guidelines

When generating areas, be creative but consistent:
- **Corridors**: Narrow passages connecting rooms, may have hazards
- **Rooms**: Larger spaces for combat or exploration
- **Junctions**: Multi-directional hubs
- **Shafts**: Vertical passages (up/down navigation)
- **Caverns**: Irregular organic spaces (especially for alien_hive)

Each area should feel unique. Describe what makes it interesting - corroded panels revealing wiring, pulsing organic membranes, ancient glyphs that glow faintly.

## Narrative Voice

Be atmospheric but concise. Examples:
- "The corridor's walls breathe with a slow, rhythmic pulse. Bioluminescent veins trace patterns that almost seem deliberate."
- "Emergency lights flicker through layers of condensation. Something large moved through here recently."
- "Glyphs older than human civilization line the walls, their meaning lost but their power still palpable."

## Responding to Players

When the player asks questions or gives commands:
- If they want to start: Call `start_game`
- If they're exploring: The UI handles movement, you describe what they find
- If they ask about lore: Be creative but consistent with the theme
- Keep responses conversational but evocative

Format responses in HTML (not markdown):
- Use <p> for paragraphs
- Use <em> for emphasis
- Use <strong> for important terms

You are the architect of an infinite, procedurally generated dungeon. Make each discovery feel earned and each area feel alive."""


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
    """ReAct agent that uses an LLM to run the Descent game."""

    llm: LLMProvider
    mcp_client: MCPClient
    max_turns: int = 10
    history: list[Message] = field(default_factory=list)

    async def chat(self, user_message: str) -> AsyncIterator[AgentEvent]:
        """Process a user message and yield events."""
        self.history.append(Message(role="user", content=user_message))

        tools = await self.mcp_client.get_tools()
        logger.info(f"Agent has {len(tools)} tools available")

        turns = 0
        while turns < self.max_turns:
            turns += 1
            logger.debug(f"Agent turn {turns}/{self.max_turns}")

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

            if accumulated_text or tool_calls:
                self.history.append(
                    Message(
                        role="assistant",
                        content=accumulated_text,
                        tool_calls=tool_calls if tool_calls else None,
                    )
                )

            if not tool_calls:
                logger.info("Agent finished (no more tool calls)")
                yield AgentEvent(type="done")
                return

            for tc in tool_calls:
                logger.info(f"Executing tool: {tc.name}")
                try:
                    result = await self.mcp_client.call_tool(tc.name, tc.arguments)

                    yield AgentEvent(
                        type="tool_result",
                        tool_name=tc.name,
                        tool_result=result.content,
                    )

                    if result.structured_content:
                        yield AgentEvent(
                            type="structured_content",
                            structured_content=result.structured_content,
                        )

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

                    self.history.append(
                        Message(
                            role="tool",
                            content=f"Error: {e}",
                            tool_call_id=tc.id,
                        )
                    )

        logger.warning(f"Agent hit max turns ({self.max_turns})")
        yield AgentEvent(
            type="error",
            error=f"Reached maximum number of turns ({self.max_turns})",
        )

    def clear_history(self) -> None:
        """Clear conversation history."""
        self.history.clear()
        logger.info("Agent history cleared")
