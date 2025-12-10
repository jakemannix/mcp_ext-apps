"""
MCP Apps Gradio Host - A Python/Gradio host for MCP Apps

This host can be deployed on Hugging Face Spaces to run MCP Apps in the browser.
It uses the Python MCP SDK for server connections and JavaScript for iframe communication.
"""

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

import gradio as gr
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.types import Tool, CallToolResult, TextContent, ImageContent

# Host implementation info
HOST_INFO = {"name": "Gradio MCP Host", "version": "1.0.0"}
PROTOCOL_VERSION = "2025-11-21"

# Resource MIME type for MCP Apps
RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"


@dataclass
class ServerConnection:
    """Represents a connection to an MCP server."""
    url: str
    name: str
    session: ClientSession
    tools: dict[str, Tool] = field(default_factory=dict)


@dataclass
class AppState:
    """Global application state."""
    connections: dict[str, ServerConnection] = field(default_factory=dict)
    current_tool_call: dict | None = None


# Global state (in production, use proper state management)
app_state = AppState()


async def connect_to_server(server_url: str) -> tuple[str, str, list]:
    """
    Connect to an MCP server and retrieve its tools.

    Returns:
        Tuple of (status message, server name, list of tool choices)
    """
    if not server_url:
        return "Please enter a server URL", "", []

    # Ensure URL ends with /mcp for MCP servers
    if not server_url.endswith("/mcp"):
        server_url = server_url.rstrip("/") + "/mcp"

    try:
        # Create a new connection using streamable HTTP transport
        async with streamablehttp_client(server_url) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                # Initialize the session
                await session.initialize()

                # Get server info
                server_name = "MCP Server"
                if hasattr(session, '_server_info') and session._server_info:
                    server_name = session._server_info.name or server_name

                # List available tools
                tools_result = await session.list_tools()
                tools = {tool.name: tool for tool in tools_result.tools}

                # Store connection info (note: connection is closed after this context)
                # For a real app, you'd want to keep the connection alive
                conn_id = str(uuid.uuid4())[:8]

                # Create tool choices for dropdown
                tool_choices = []
                for tool in tools_result.tools:
                    # Check if tool has UI resource (Python SDK uses 'meta', TS SDK uses '_meta')
                    has_ui = tool.meta and tool.meta.get("ui/resourceUri")
                    ui_marker = " [UI]" if has_ui else ""
                    tool_choices.append((f"{tool.name}{ui_marker}", tool.name))

                # Store tools in state for later use
                app_state.connections[conn_id] = ServerConnection(
                    url=server_url,
                    name=server_name,
                    session=None,  # Session is closed, we'll reconnect when needed
                    tools=tools
                )

                return (
                    f"Connected to {server_name}! Found {len(tools)} tools.",
                    conn_id,
                    tool_choices
                )

    except Exception as e:
        return f"Connection failed: {str(e)}", "", []


def get_tool_info(conn_id: str, tool_name: str) -> tuple[str, str, str]:
    """
    Get information about a selected tool.

    Returns:
        Tuple of (description, input schema JSON, UI resource URI or empty)
    """
    if not conn_id or not tool_name or conn_id not in app_state.connections:
        return "", "{}", ""

    conn = app_state.connections[conn_id]
    tool = conn.tools.get(tool_name)

    if not tool:
        return "", "{}", ""

    description = tool.description or "No description available"
    schema = json.dumps(tool.inputSchema, indent=2) if tool.inputSchema else "{}"
    ui_uri = tool.meta.get("ui/resourceUri", "") if tool.meta else ""

    return description, schema, ui_uri


async def call_tool_and_get_ui(
    conn_id: str,
    tool_name: str,
    args_json: str
) -> tuple[str, str, str, dict]:
    """
    Call a tool and fetch its UI resource if available.

    Returns:
        Tuple of (status, result JSON, UI HTML, iframe config dict)
    """
    if not conn_id or not tool_name:
        return "Please select a server and tool", "", "", {}

    if conn_id not in app_state.connections:
        return "Server connection not found. Please reconnect.", "", "", {}

    conn = app_state.connections[conn_id]
    tool = conn.tools.get(tool_name)

    if not tool:
        return f"Tool '{tool_name}' not found", "", "", {}

    # Parse arguments
    try:
        args = json.loads(args_json) if args_json.strip() else {}
    except json.JSONDecodeError as e:
        return f"Invalid JSON arguments: {e}", "", "", {}

    try:
        # Reconnect to the server for this call
        async with streamablehttp_client(conn.url) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # Call the tool
                result = await session.call_tool(tool_name, arguments=args)

                # Format result content
                result_text = format_tool_result(result)

                # Check for UI resource
                ui_uri = tool.meta.get("ui/resourceUri") if tool.meta else None
                ui_html = ""
                csp_config = {}

                if ui_uri and ui_uri.startswith("ui://"):
                    # Fetch the UI resource
                    try:
                        resource_result = await session.read_resource(ui_uri)
                        if resource_result.contents:
                            content = resource_result.contents[0]
                            if hasattr(content, 'text'):
                                ui_html = content.text
                            elif hasattr(content, 'blob'):
                                import base64
                                ui_html = base64.b64decode(content.blob).decode('utf-8')

                            # Extract CSP metadata (Python SDK uses 'meta', TS SDK uses '_meta')
                            meta = getattr(content, 'meta', None) or getattr(content, '_meta', None)
                            if meta and isinstance(meta, dict):
                                ui_meta = meta.get('ui', {})
                                csp_config = ui_meta.get('csp', {})
                    except Exception as e:
                        print(f"Failed to fetch UI resource: {e}")

                # Create iframe configuration
                iframe_config = {
                    "tool_name": tool_name,
                    "tool_args": args,
                    "tool_result": serialize_tool_result(result),
                    "ui_html": ui_html,
                    "csp": csp_config,
                    "host_info": HOST_INFO,
                    "protocol_version": PROTOCOL_VERSION
                }

                return (
                    f"Tool '{tool_name}' executed successfully!",
                    result_text,
                    ui_html,
                    iframe_config
                )

    except Exception as e:
        return f"Tool execution failed: {str(e)}", "", "", {}


def format_tool_result(result: CallToolResult) -> str:
    """Format tool result content for display."""
    parts = []
    for content in result.content:
        if isinstance(content, TextContent):
            parts.append(content.text)
        elif isinstance(content, ImageContent):
            parts.append(f"[Image: {content.mimeType}]")
        else:
            parts.append(f"[{content.type}]")
    return "\n".join(parts)


def serialize_tool_result(result: CallToolResult) -> dict:
    """Serialize tool result for JSON transport."""
    content = []
    for c in result.content:
        if isinstance(c, TextContent):
            content.append({"type": "text", "text": c.text})
        elif isinstance(c, ImageContent):
            content.append({
                "type": "image",
                "data": c.data,
                "mimeType": c.mimeType
            })
        else:
            content.append({"type": c.type})

    return {
        "content": content,
        "isError": result.isError if hasattr(result, 'isError') else False
    }


def generate_app_iframe(iframe_config: dict) -> str:
    """
    Generate the HTML for the MCP App iframe with embedded JavaScript bridge.

    This creates a sandboxed iframe structure that:
    1. Creates an outer sandbox iframe
    2. Loads the Guest UI HTML into an inner iframe
    3. Handles JSON-RPC communication via postMessage
    """
    if not iframe_config or not iframe_config.get("ui_html"):
        return ""

    ui_html = iframe_config.get("ui_html", "")
    csp = iframe_config.get("csp", {})
    tool_args = iframe_config.get("tool_args", {})
    tool_result = iframe_config.get("tool_result", {})
    host_info = iframe_config.get("host_info", HOST_INFO)
    protocol_version = iframe_config.get("protocol_version", PROTOCOL_VERSION)

    # Escape the HTML for embedding
    ui_html_escaped = json.dumps(ui_html)
    csp_json = json.dumps(csp)
    tool_args_json = json.dumps(tool_args)
    tool_result_json = json.dumps(tool_result)
    host_info_json = json.dumps(host_info)

    # Generate the complete iframe HTML with embedded JavaScript bridge
    return f'''
<div id="mcp-app-container" style="width: 100%; min-height: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #f9f9f9;">
    <iframe
        id="mcp-sandbox-frame"
        style="width: 100%; height: 400px; border: none;"
        sandbox="allow-scripts allow-same-origin allow-forms"
    ></iframe>
</div>

<script type="module">
(function() {{
    const PROTOCOL_VERSION = {json.dumps(protocol_version)};
    const HOST_INFO = {host_info_json};
    const UI_HTML = {ui_html_escaped};
    const CSP_CONFIG = {csp_json};
    const TOOL_ARGS = {tool_args_json};
    const TOOL_RESULT = {tool_result_json};

    const sandboxFrame = document.getElementById('mcp-sandbox-frame');
    const container = document.getElementById('mcp-app-container');

    // State for JSON-RPC
    let requestId = 0;
    const pendingRequests = new Map();
    let initialized = false;

    // Build CSP meta tag
    function buildCspMetaTag(csp) {{
        const resourceDomains = csp?.resourceDomains?.join(' ') || '';
        const connectDomains = csp?.connectDomains?.join(' ') || '';

        const directives = [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${{resourceDomains}}`.trim(),
            `style-src 'self' 'unsafe-inline' blob: data: ${{resourceDomains}}`.trim(),
            `img-src 'self' data: blob: ${{resourceDomains}}`.trim(),
            `font-src 'self' data: blob: ${{resourceDomains}}`.trim(),
            `connect-src 'self' ${{connectDomains}}`.trim(),
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'self'"
        ];

        return `<meta http-equiv="Content-Security-Policy" content="${{directives.join('; ')}}">`;
    }}

    // Create sandbox proxy HTML
    function createSandboxHtml() {{
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        html, body {{ margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }}
        iframe {{ width: 100%; height: 100%; border: none; }}
    </style>
</head>
<body>
    <iframe id="inner-frame" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
    <script>
        const innerFrame = document.getElementById('inner-frame');

        // Message relay between parent and inner frame
        window.addEventListener('message', (event) => {{
            if (event.source === window.parent) {{
                // From host to inner frame
                if (event.data?.method === 'ui/notifications/sandbox-resource-ready') {{
                    // Load the UI HTML into inner frame
                    let html = event.data.params.html;
                    const csp = event.data.params.csp;
                    if (csp) {{
                        const cspMeta = buildCspMeta(csp);
                        if (html.includes('<head>')) {{
                            html = html.replace('<head>', '<head>\\n' + cspMeta);
                        }} else {{
                            html = cspMeta + html;
                        }}
                    }}
                    innerFrame.srcdoc = html;
                }} else if (innerFrame.contentWindow) {{
                    innerFrame.contentWindow.postMessage(event.data, '*');
                }}
            }} else if (event.source === innerFrame.contentWindow) {{
                // From inner frame to host
                window.parent.postMessage(event.data, '*');
            }}
        }});

        function buildCspMeta(csp) {{
            const resourceDomains = csp?.resourceDomains?.join(' ') || '';
            const connectDomains = csp?.connectDomains?.join(' ') || '';
            const directives = [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: " + resourceDomains,
                "style-src 'self' 'unsafe-inline' blob: data: " + resourceDomains,
                "img-src 'self' data: blob: " + resourceDomains,
                "font-src 'self' data: blob: " + resourceDomains,
                "connect-src 'self' " + connectDomains,
                "frame-src 'none'",
                "object-src 'none'",
                "base-uri 'self'"
            ];
            return '<meta http-equiv="Content-Security-Policy" content="' + directives.join('; ') + '">';
        }}

        // Notify parent that sandbox is ready
        window.parent.postMessage({{
            jsonrpc: '2.0',
            method: 'ui/notifications/sandbox-proxy-ready',
            params: {{}}
        }}, '*');
    <\\/script>
</body>
</html>`;
    }}

    // Handle messages from the sandbox/app
    function handleMessage(event) {{
        if (event.source !== sandboxFrame.contentWindow) return;

        const message = event.data;
        if (!message || typeof message !== 'object') return;

        console.log('[GradioHost] Received:', message);

        // Handle notifications
        if (message.method === 'ui/notifications/sandbox-proxy-ready') {{
            // Sandbox is ready, send the UI HTML
            sendToSandbox({{
                jsonrpc: '2.0',
                method: 'ui/notifications/sandbox-resource-ready',
                params: {{
                    html: UI_HTML,
                    csp: CSP_CONFIG
                }}
            }});
        }}
        else if (message.method === 'ui/notifications/initialized') {{
            // App is initialized, send tool input and result
            initialized = true;
            console.log('[GradioHost] App initialized, sending tool data');

            // Send tool input
            sendToSandbox({{
                jsonrpc: '2.0',
                method: 'ui/notifications/tool-input',
                params: {{ arguments: TOOL_ARGS }}
            }});

            // Send tool result
            setTimeout(() => {{
                sendToSandbox({{
                    jsonrpc: '2.0',
                    method: 'ui/notifications/tool-result',
                    params: TOOL_RESULT
                }});
            }}, 100);
        }}
        else if (message.method === 'ui/notifications/size-changed') {{
            // Handle size change request
            const {{ width, height }} = message.params || {{}};
            if (height) {{
                sandboxFrame.style.height = `${{height}}px`;
                container.style.minHeight = `${{height}}px`;
            }}
            if (width) {{
                sandboxFrame.style.minWidth = `${{Math.min(width, container.clientWidth)}}px`;
            }}
        }}
        else if (message.method === 'ui/initialize') {{
            // Respond to initialization request
            const response = {{
                jsonrpc: '2.0',
                id: message.id,
                result: {{
                    protocolVersion: PROTOCOL_VERSION,
                    hostInfo: HOST_INFO,
                    hostCapabilities: {{
                        openLinks: {{}},
                        serverTools: {{}},
                        logging: {{}}
                    }},
                    hostContext: {{
                        theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
                    }}
                }}
            }};
            sendToSandbox(response);
        }}
        else if (message.method === 'ui/open-link') {{
            // Handle open link request
            const url = message.params?.url;
            if (url) {{
                window.open(url, '_blank', 'noopener,noreferrer');
            }}
            if (message.id) {{
                sendToSandbox({{
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {{}}
                }});
            }}
        }}
        else if (message.method === 'ui/message') {{
            // Handle message request (log it for now)
            console.log('[GradioHost] Message from app:', message.params);
            if (message.id) {{
                sendToSandbox({{
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {{}}
                }});
            }}
        }}
        else if (message.method === 'notifications/message') {{
            // Handle log messages
            console.log('[GradioHost] Log:', message.params);
        }}
    }}

    function sendToSandbox(message) {{
        console.log('[GradioHost] Sending:', message);
        sandboxFrame.contentWindow?.postMessage(message, '*');
    }}

    // Set up message listener
    window.addEventListener('message', handleMessage);

    // Load the sandbox
    sandboxFrame.srcdoc = createSandboxHtml();
}})();
</script>
'''


# Create the Gradio interface
with gr.Blocks(
    title="MCP Apps Host",
    theme=gr.themes.Soft(),
    css="""
    .tool-info { font-family: monospace; white-space: pre-wrap; }
    .app-container { min-height: 400px; }
    """
) as demo:

    gr.Markdown("""
    # MCP Apps Host

    Connect to MCP servers and interact with tools that have rich UI components.

    This host demonstrates the MCP Apps protocol, allowing you to:
    - Connect to MCP servers via HTTP
    - Browse and execute available tools
    - View interactive UI widgets from tools that support them
    """)

    # State
    conn_id_state = gr.State("")
    iframe_config_state = gr.State({})

    with gr.Row():
        with gr.Column(scale=1):
            gr.Markdown("### 1. Connect to Server")

            server_url = gr.Textbox(
                label="Server URL",
                placeholder="http://localhost:3108",
                value="http://localhost:3108",
                info="Enter the MCP server URL (will append /mcp if needed)"
            )
            connect_btn = gr.Button("Connect", variant="primary")
            connection_status = gr.Textbox(
                label="Status",
                interactive=False
            )

            gr.Markdown("### 2. Select Tool")

            tool_dropdown = gr.Dropdown(
                label="Available Tools",
                choices=[],
                interactive=True,
                info="Tools marked with [UI] have interactive widgets"
            )

            tool_description = gr.Textbox(
                label="Description",
                interactive=False,
                lines=2
            )

            tool_schema = gr.Code(
                label="Input Schema",
                language="json",
                interactive=False
            )

            gr.Markdown("### 3. Call Tool")

            tool_args = gr.Code(
                label="Arguments (JSON)",
                language="json",
                value="{}",
                lines=5
            )

            call_btn = gr.Button("Execute Tool", variant="primary")
            call_status = gr.Textbox(
                label="Execution Status",
                interactive=False
            )

        with gr.Column(scale=2):
            gr.Markdown("### Tool Result")

            result_text = gr.Textbox(
                label="Result Content",
                interactive=False,
                lines=5
            )

            gr.Markdown("### Interactive Widget")

            app_html = gr.HTML(
                label="MCP App",
                elem_classes=["app-container"]
            )

    # Example servers section
    with gr.Accordion("Example Servers", open=False):
        gr.Markdown("""
        **QR Server** (run locally):
        ```bash
        cd examples/qr-server
        pip install -r requirements.txt
        python server.py
        ```
        Then connect to: `http://localhost:3108`

        **Try this JSON for the generate_qr tool:**
        ```json
        {"text": "https://modelcontextprotocol.io", "fill_color": "#6366f1"}
        ```
        """)

    # Event handlers
    connect_btn.click(
        fn=connect_to_server,
        inputs=[server_url],
        outputs=[connection_status, conn_id_state, tool_dropdown]
    )

    tool_dropdown.change(
        fn=get_tool_info,
        inputs=[conn_id_state, tool_dropdown],
        outputs=[tool_description, tool_schema, gr.State()]
    )

    call_btn.click(
        fn=call_tool_and_get_ui,
        inputs=[conn_id_state, tool_dropdown, tool_args],
        outputs=[call_status, result_text, gr.State(), iframe_config_state]
    ).then(
        fn=generate_app_iframe,
        inputs=[iframe_config_state],
        outputs=[app_html]
    )


if __name__ == "__main__":
    demo.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False
    )
