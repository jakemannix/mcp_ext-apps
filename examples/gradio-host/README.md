# MCP Apps Gradio Host

A Python/Gradio host for MCP Apps that can be deployed on Hugging Face Spaces.

## Overview

This host demonstrates how to integrate MCP Apps (interactive tool widgets) into a Gradio application. It provides:

- **Server Connection**: Connect to MCP servers via HTTP
- **Tool Discovery**: Browse available tools and their schemas
- **Tool Execution**: Call tools with custom arguments
- **Interactive Widgets**: Display MCP App UIs in sandboxed iframes

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Python Backend (Gradio + MCP SDK)                          │
│  - Connects to MCP servers                                   │
│  - Lists tools and resources                                 │
│  - Executes tool calls                                       │
│  - Fetches UI resources                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Gradio Frontend                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  JavaScript Bridge (embedded in gr.HTML)                │ │
│  │  - Handles JSON-RPC protocol                            │ │
│  │  - Manages postMessage communication                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Sandbox Iframe (outer)                                 │ │
│  │  ┌─────────────────────────────────────────────────────┐│ │
│  │  │  Guest UI Iframe (inner) - MCP App                 ││ │
│  │  └─────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Local Development

### Prerequisites

- Python 3.10+
- An MCP server to connect to (e.g., the QR Server example)

### Setup

```bash
# Navigate to this directory
cd examples/gradio-host

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

The app will be available at http://localhost:7860

### Testing with QR Server

1. In a separate terminal, start the QR Server:
   ```bash
   cd ../qr-server
   pip install -r requirements.txt
   python server.py
   ```

2. In the Gradio host:
   - Connect to `http://localhost:3108`
   - Select the `generate_qr` tool
   - Enter arguments like: `{"text": "Hello World!"}`
   - Click "Execute Tool"
   - See the interactive QR code widget!

## Deploy to Hugging Face Spaces

### Option 1: Create a new Space

1. Go to [huggingface.co/spaces](https://huggingface.co/spaces)
2. Click "Create new Space"
3. Choose "Gradio" as the SDK
4. Upload these files:
   - `app.py`
   - `requirements.txt`

### Option 2: Clone and push

```bash
# Clone your space
git clone https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE

# Copy the files
cp app.py requirements.txt YOUR_SPACE/

# Push
cd YOUR_SPACE
git add .
git commit -m "Add MCP Apps Gradio Host"
git push
```

### Space Configuration

Create a `README.md` in your Space with this YAML header:

```yaml
---
title: MCP Apps Host
emoji: 🔌
colorFrom: blue
colorTo: purple
sdk: gradio
sdk_version: 4.44.1
app_file: app.py
pinned: false
---
```

## Connecting to External MCP Servers

When deployed on HF Spaces, you'll need to connect to publicly accessible MCP servers. The server must:

1. Support HTTP/Streamable HTTP transport
2. Have CORS enabled for cross-origin requests
3. Be accessible from the internet

Example server configuration for public access:

```python
from starlette.middleware.cors import CORSMiddleware

app = mcp.streamable_http_app()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specify your HF Space URL
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## How It Works

### MCP Apps Protocol

MCP Apps extend the Model Context Protocol with interactive UI capabilities:

1. **Tool Metadata**: Tools can specify a `ui/resourceUri` in their metadata
2. **UI Resources**: HTML resources with MIME type `text/html;profile=mcp-app`
3. **JSON-RPC Communication**: Apps communicate with hosts via postMessage

### Security

The host uses a double-iframe sandbox architecture:

- **Outer iframe**: Sandbox proxy that relays messages
- **Inner iframe**: Guest UI with Content Security Policy

CSP is injected based on the resource's `_meta.ui.csp` configuration.

## Limitations

- **Connection Persistence**: Currently reconnects for each tool call (stateless)
- **Server-side Tools**: App-to-server tool calls are not yet fully implemented
- **Streaming**: Partial tool input streaming not yet supported

## License

MIT - See the main repository license.
