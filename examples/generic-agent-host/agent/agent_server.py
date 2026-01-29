"""HTTP server for the generic LLM agent with MCP Apps bridge support."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .agent import Agent, AgentEvent
from .llm import create_provider, ConfigError
from .mcp_client import MCPClient

logger = logging.getLogger(__name__)

# Global agent instance (created on startup)
_agent: Agent | None = None
_mcp_client: MCPClient | None = None


async def startup() -> None:
    """Initialize agent on server startup."""
    global _agent, _mcp_client

    mcp_url = os.environ.get("MCP_SERVER_URL", "http://localhost:3002")
    logger.info(f"Initializing agent server, MCP server: {mcp_url}")

    # Create MCP client
    _mcp_client = MCPClient(base_url=mcp_url)

    # Test connection to MCP server
    try:
        tools = await _mcp_client.list_tools()
        logger.info(f"Connected to MCP server, found {len(tools)} tools: {[t.name for t in tools]}")
    except Exception as e:
        logger.error(f"Failed to connect to MCP server at {mcp_url}: {e}")
        logger.error("Make sure the MCP server is running")
        raise

    # Create LLM provider
    try:
        provider = create_provider()
        logger.info(f"Using LLM provider: {provider.name} ({provider.model})")
    except ConfigError as e:
        logger.error(f"LLM configuration error: {e}")
        raise

    # Create agent
    _agent = Agent(llm=provider, mcp_client=_mcp_client)
    logger.info("Agent initialized successfully")


async def shutdown() -> None:
    """Clean up on server shutdown."""
    global _mcp_client
    if _mcp_client:
        await _mcp_client.close()
        logger.info("MCP client closed")


async def index(request: Request) -> HTMLResponse:
    """Serve the main agent UI."""
    static_dir = Path(__file__).parent / "static"
    html_file = static_dir / "index.html"

    if not html_file.exists():
        return HTMLResponse("<h1>index.html not found</h1>", status_code=500)

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


async def app_message(request: Request) -> StreamingResponse:
    """Handle ui/message from the MCP App (forwarded by frontend).

    When the app sends a message with role="assistant", we inject it into
    the conversation and continue the agent loop.
    """
    global _agent

    if not _agent:
        return JSONResponse({"error": "Agent not initialized"}, status_code=500)

    try:
        body = await request.json()
        role = body.get("role", "user")
        content = body.get("content", [])
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    # Extract text content
    text_content = ""
    for block in content:
        if block.get("type") == "text":
            text_content += block.get("text", "")

    if not text_content:
        return JSONResponse({"error": "No text content in message"}, status_code=400)

    logger.info(f"App message (role={role}): {text_content[:100]}...")

    async def event_stream():
        try:
            if role == "assistant":
                # Inject as assistant message and continue
                async for event in _agent.inject_assistant_message(text_content):
                    yield format_sse_event(event)
            else:
                # Treat as user message
                async for event in _agent.chat(text_content):
                    yield format_sse_event(event)
        except Exception as e:
            logger.exception("Error handling app message")
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


async def update_context(request: Request) -> JSONResponse:
    """Handle updateModelContext from the MCP App."""
    global _agent

    if not _agent:
        return JSONResponse({"error": "Agent not initialized"}, status_code=500)

    try:
        body = await request.json()
        content = body.get("content", [])
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    # Extract text content
    text_content = ""
    for block in content:
        if block.get("type") == "text":
            text_content += block.get("text", "")

    _agent.update_model_context(text_content if text_content else None)

    return JSONResponse({"status": "ok"})


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
        "mcp_server": os.environ.get("MCP_SERVER_URL", "http://localhost:3002"),
    })


async def tools(request: Request) -> JSONResponse:
    """List available tools from the MCP server."""
    global _mcp_client

    if not _mcp_client:
        return JSONResponse({"error": "MCP client not initialized"}, status_code=500)

    try:
        tool_list = await _mcp_client.list_tools()
        return JSONResponse({
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                }
                for t in tool_list
            ]
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


async def app_resource(request: Request) -> JSONResponse:
    """Fetch an MCP App resource by URI."""
    global _mcp_client

    if not _mcp_client:
        return JSONResponse({"error": "MCP client not initialized"}, status_code=500)

    uri = request.query_params.get("uri")
    if not uri:
        return JSONResponse({"error": "No URI provided"}, status_code=400)

    try:
        result = await _mcp_client.read_resource(uri)
        return JSONResponse(result)
    except Exception as e:
        logger.exception(f"Error fetching resource {uri}")
        return JSONResponse({"error": str(e)}, status_code=500)


async def app_info(request: Request) -> JSONResponse:
    """Get MCP App info (resource URIs from tool metadata)."""
    global _mcp_client

    if not _mcp_client:
        return JSONResponse({"error": "MCP client not initialized"}, status_code=500)

    try:
        # Get tools and find UI resource URIs
        tool_list = await _mcp_client.list_tools()

        # The MCP client returns simplified Tool objects, we need the raw data
        # Re-fetch with full metadata
        result = await _mcp_client._send_request("tools/list")
        tools_raw = result.get("tools", [])

        ui_resources = []
        for tool in tools_raw:
            meta = tool.get("_meta", {})
            ui = meta.get("ui", {})
            resource_uri = ui.get("resourceUri")
            if resource_uri:
                ui_resources.append({
                    "toolName": tool.get("name"),
                    "resourceUri": resource_uri,
                })

        return JSONResponse({"apps": ui_resources})
    except Exception as e:
        logger.exception("Error getting app info")
        return JSONResponse({"error": str(e)}, status_code=500)


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


def create_app() -> Starlette:
    """Create the Starlette application."""
    static_dir = Path(__file__).parent / "static"

    routes = [
        Route("/", index),
        Route("/chat", chat, methods=["POST"]),
        Route("/app-message", app_message, methods=["POST"]),
        Route("/update-context", update_context, methods=["POST"]),
        Route("/clear", clear_history, methods=["POST"]),
        Route("/health", health),
        Route("/tools", tools),
        Route("/app-resource", app_resource),
        Route("/app-info", app_info),
    ]

    # Only mount static files if directory exists
    if static_dir.exists():
        routes.append(Mount("/static", StaticFiles(directory=str(static_dir)), name="static"))

    app = Starlette(
        routes=routes,
        on_startup=[startup],
        on_shutdown=[shutdown],
    )

    # Add CORS middleware for development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app


def run_server(host: str = "0.0.0.0", port: int = 3004, log_level: str = "info") -> None:
    """Run the agent server."""
    import uvicorn

    mcp_url = os.environ.get("MCP_SERVER_URL", "http://localhost:3002")
    logger.info(f"Starting generic agent server on http://{host}:{port}")
    logger.info(f"MCP server: {mcp_url}")

    uvicorn.run(
        create_app(),
        host=host,
        port=port,
        log_level=log_level,
    )
