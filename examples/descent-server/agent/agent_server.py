"""HTTP server for the Descent LLM agent with SSE streaming."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .agent import Agent, AgentEvent
from .llm import create_provider, ConfigError
from .mcp_client import MCPClient

logger = logging.getLogger(__name__)

_agent: Agent | None = None
_mcp_client: MCPClient | None = None


async def startup() -> None:
    """Initialize agent on server startup."""
    global _agent, _mcp_client

    logger.info("Initializing Descent agent server...")

    # Create MCP client - connect to descent-server on port 3001
    _mcp_client = MCPClient(base_url="http://localhost:3001")

    try:
        tools = await _mcp_client.list_tools()
        logger.info(f"Connected to descent-server, found {len(tools)} tools: {[t.name for t in tools]}")
    except Exception as e:
        logger.error(f"Failed to connect to descent-server: {e}")
        logger.error("Make sure descent-server is running: npm run serve:http")
        raise

    try:
        provider = create_provider()
        logger.info(f"Using LLM provider: {provider.name} ({provider.model})")
    except ConfigError as e:
        logger.error(f"LLM configuration error: {e}")
        raise

    _agent = Agent(llm=provider, mcp_client=_mcp_client)
    logger.info("Descent agent initialized successfully")


async def shutdown() -> None:
    """Clean up on server shutdown."""
    global _mcp_client
    if _mcp_client:
        await _mcp_client.close()
        logger.info("MCP client closed")


async def index(request: Request) -> HTMLResponse:
    """Serve the agent UI."""
    static_dir = Path(__file__).parent / "static"
    html_file = static_dir / "agent_ui.html"

    if not html_file.exists():
        return HTMLResponse("<h1>agent_ui.html not found</h1>", status_code=500)

    return HTMLResponse(html_file.read_text())


async def chat(request: Request) -> StreamingResponse:
    """Handle chat requests with SSE streaming."""
    global _agent

    if not _agent:
        return JSONResponse({"error": "Agent not initialized"}, status_code=500)

    try:
        body = await request.json()
        message = body.get("message", "")
        clear_history = body.get("clear_history", False)
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    if not message:
        return JSONResponse({"error": "No message provided"}, status_code=400)

    if clear_history:
        _agent.clear_history()

    logger.info(f"Chat request: {message[:100]}...")

    async def event_stream():
        try:
            async for event in _agent.chat(message):
                yield format_sse_event(event)
        except Exception as e:
            logger.exception("Error in agent chat")
            yield format_sse_event(AgentEvent(type="error", error=str(e)))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def format_sse_event(event: AgentEvent) -> str:
    """Format an AgentEvent as an SSE message."""
    data = {"type": event.type}

    if event.text is not None:
        data["text"] = event.text
    if event.tool_name is not None:
        data["tool_name"] = event.tool_name
    if event.tool_args is not None:
        data["tool_args"] = event.tool_args
    if event.tool_result is not None:
        data["tool_result"] = event.tool_result
    if event.structured_content is not None:
        data["structured_content"] = event.structured_content
    if event.error is not None:
        data["error"] = event.error

    return f"data: {json.dumps(data)}\n\n"


async def clear_history(request: Request) -> JSONResponse:
    """Clear agent conversation history."""
    global _agent
    if _agent:
        _agent.clear_history()
    return JSONResponse({"status": "ok"})


async def health(request: Request) -> JSONResponse:
    """Health check endpoint."""
    return JSONResponse({
        "status": "ok",
        "agent_initialized": _agent is not None,
    })


def create_app() -> Starlette:
    """Create the Starlette application."""
    static_dir = Path(__file__).parent / "static"

    routes = [
        Route("/", index),
        Route("/chat", chat, methods=["POST"]),
        Route("/clear", clear_history, methods=["POST"]),
        Route("/health", health),
    ]

    # Only mount static files if directory exists
    if static_dir.exists():
        routes.append(Mount("/static", StaticFiles(directory=str(static_dir)), name="static"))

    return Starlette(
        routes=routes,
        on_startup=[startup],
        on_shutdown=[shutdown],
    )


def run_server(host: str = "0.0.0.0", port: int = 3004, log_level: str = "info") -> None:
    """Run the agent server."""
    import uvicorn

    logger.info(f"Starting Descent agent server on http://{host}:{port}")
    logger.info("Make sure descent-server is running on port 3001")

    uvicorn.run(
        create_app(),
        host=host,
        port=port,
        log_level=log_level,
    )
