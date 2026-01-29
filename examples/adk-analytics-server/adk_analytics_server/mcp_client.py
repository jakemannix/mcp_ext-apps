"""MCP client for connecting to the analytics server."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from .llm.base import Tool

logger = logging.getLogger(__name__)


@dataclass
class ToolResult:
    """Result from an MCP tool call."""

    content: str
    structured_content: dict[str, Any] | None = None
    is_error: bool = False


class MCPClientError(Exception):
    """Raised when MCP client encounters an error."""

    pass


class MCPClient:
    """Client for communicating with an MCP server over HTTP."""

    def __init__(self, base_url: str = "http://localhost:3003"):
        """Initialize the MCP client.

        Args:
            base_url: Base URL of the MCP server
        """
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=60.0)
        self._tools: list[Tool] | None = None
        self._request_id = 0

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "MCPClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    def _next_id(self) -> int:
        """Get next request ID."""
        self._request_id += 1
        return self._request_id

    async def _send_request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a JSON-RPC request to the MCP server."""
        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
        }
        if params:
            request["params"] = params

        logger.debug(f"MCP request: {method} {params}")

        try:
            response = await self._client.post(
                f"{self._base_url}/mcp",
                json=request,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as e:
            raise MCPClientError(f"HTTP error communicating with MCP server: {e}")

        # Parse response - MCP server returns SSE format
        body = response.text
        result = self._parse_sse_response(body)

        if "error" in result:
            error = result["error"]
            raise MCPClientError(f"MCP error: {error.get('message', str(error))}")

        logger.debug(f"MCP response: {result.get('result', {})}")
        return result.get("result")

    def _parse_sse_response(self, body: str) -> dict[str, Any]:
        """Parse SSE response from MCP server.

        The server returns responses in SSE format:
        event: message
        data: {"jsonrpc":"2.0",...}
        """
        # Look for data lines and extract JSON
        for line in body.split("\n"):
            line = line.strip()
            if line.startswith("data: "):
                json_str = line[6:]  # Remove "data: " prefix
                try:
                    return json.loads(json_str)
                except json.JSONDecodeError as e:
                    raise MCPClientError(f"Invalid JSON in SSE response: {e}")

        # If no data line found, try parsing the whole body as JSON
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            raise MCPClientError(f"Could not parse MCP response: {e}")

    async def list_tools(self) -> list[Tool]:
        """List available tools from the MCP server.

        Returns:
            List of Tool objects
        """
        result = await self._send_request("tools/list")
        tools = []

        for tool_def in result.get("tools", []):
            tools.append(
                Tool(
                    name=tool_def["name"],
                    description=tool_def.get("description", ""),
                    parameters=tool_def.get("inputSchema", {}),
                )
            )

        self._tools = tools
        logger.info(f"Loaded {len(tools)} tools from MCP server")
        return tools

    async def get_tools(self) -> list[Tool]:
        """Get tools, fetching from server if not cached.

        Returns:
            List of Tool objects
        """
        if self._tools is None:
            return await self.list_tools()
        return self._tools

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        """Call a tool on the MCP server.

        Args:
            name: Tool name
            arguments: Tool arguments

        Returns:
            ToolResult with content and optional structured_content
        """
        logger.info(f"Calling tool: {name}")
        logger.debug(f"Tool arguments: {arguments}")

        result = await self._send_request(
            "tools/call",
            {"name": name, "arguments": arguments},
        )

        # Extract content from MCP response
        content_parts = result.get("content", [])
        text_content = ""
        is_error = result.get("isError", False)

        for part in content_parts:
            if part.get("type") == "text":
                text_content += part.get("text", "")

        # structuredContent is at the top level of the result
        structured_content = result.get("structuredContent")

        logger.debug(f"Tool result: {text_content[:200]}..." if len(text_content) > 200 else f"Tool result: {text_content}")
        if structured_content:
            logger.debug(f"Has structured content with keys: {list(structured_content.keys()) if isinstance(structured_content, dict) else 'non-dict'}")

        return ToolResult(
            content=text_content,
            structured_content=structured_content,
            is_error=is_error,
        )
