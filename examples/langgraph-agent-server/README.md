# LangGraph Agent Visualizer

An MCP Apps demo showcasing **LangGraph** integration with interactive 3D visualization.

## Overview

This demo demonstrates how to build an MCP server that:

1. Uses **LangGraph** for multi-step agent workflows
2. Provides **rich UI** through MCP Apps extension
3. Visualizes agent state in **interactive 3D**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP Apps Architecture                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐    MCP Protocol    ┌──────────────────────┐    │
│   │  Host Client │◄──────────────────►│  LangGraph Server    │    │
│   │  (Claude)    │                    │                      │    │
│   └──────┬───────┘                    │  ┌────────────────┐  │    │
│          │                            │  │   LangGraph    │  │    │
│          │ iframe                     │  │   Workflow     │  │    │
│          ▼                            │  │                │  │    │
│   ┌──────────────┐    postMessage     │  │  research ──►  │  │    │
│   │   3D View    │◄──────────────────►│  │  analyze  ──►  │  │    │
│   │  (Three.js)  │                    │  │  synthesize►   │  │    │
│   │              │                    │  │  conclude      │  │    │
│   └──────────────┘                    │  └────────────────┘  │    │
│                                       └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

### LangGraph Workflow

The agent implements a 4-step analysis workflow:

1. **Research** - Gathers background information about the topic
2. **Analyze** - Performs SWOT analysis
3. **Synthesize** - Combines insights into actionable intelligence
4. **Conclude** - Generates final recommendations

### Interactive 3D Visualization

- **Force-directed graph** showing workflow nodes
- **Real-time status updates** as agent progresses
- **OrbitControls** for camera manipulation
- **Glow effects** on active nodes
- **Color-coded states**: pending, active, completed

### MCP Apps Integration

- `structuredContent` for rich data delivery to UI
- `ui://` resource scheme for HTML templates
- Proper CSP configuration for Three.js

## Usage

### Start the Server

```bash
# Using uv (recommended)
uv run server.py

# Or with stdio transport for Claude Desktop
uv run server.py --stdio
```

### Connect with basic-host

1. Start the server: `uv run server.py`
2. Open basic-host at `http://localhost:8080`
3. Connect to `http://localhost:3002/mcp`
4. Call the `analyze_topic` tool

### Example Tool Calls

```json
{
  "name": "analyze_topic",
  "arguments": {
    "topic": "quantum computing"
  }
}
```

## Code Walkthrough

### Server Structure (`server.py`)

```python
# 1. Define the LangGraph workflow
workflow = StateGraph(AgentState)
workflow.add_node("research", research_node)
workflow.add_node("analyze", analyze_node)
workflow.add_node("synthesize", synthesize_node)
workflow.add_node("conclude", conclude_node)

# 2. Register MCP tool with UI metadata
@mcp.tool(meta={"ui": {"resourceUri": VIEW_URI}})
def analyze_topic(topic: str):
    # Run the LangGraph agent
    agent = create_agent_graph()
    result = agent.invoke({"topic": topic, ...})

    # Return structuredContent for the UI
    return [types.TextContent(
        type="text",
        text=summary,
        _meta={"structuredContent": graph.to_dict()},
    )]

# 3. Register the UI resource
@mcp.resource(VIEW_URI, mime_type="text/html;profile=mcp-app")
def view() -> str:
    return EMBEDDED_VIEW_HTML
```

### View Structure (embedded HTML)

```javascript
// Initialize MCP App connection
const app = new App({ name: "LangGraph Visualizer", version: "1.0.0" });

// Handle tool results
app.ontoolresult = (result) => {
  const data = result.content[0]._meta.structuredContent;
  updateGraph(data); // Update Three.js visualization
};

// Connect to host
await app.connect();
```

## Key Concepts

### 1. LangGraph Integration

LangGraph provides a declarative way to define agent workflows:

```python
from langgraph.graph import StateGraph, END

workflow = StateGraph(AgentState)
workflow.add_node("step1", step1_fn)
workflow.add_node("step2", step2_fn)
workflow.add_edge("step1", "step2")
workflow.add_edge("step2", END)
agent = workflow.compile()
```

### 2. structuredContent

The key to rich UI is `structuredContent`:

```python
return {
    "content": [{"type": "text", "text": "Summary for LLM"}],
    "structuredContent": {"nodes": [...], "edges": [...]}  # Rich data for UI
}
```

### 3. Three.js Visualization

The view uses Three.js for 3D rendering:

```javascript
// Create node spheres
const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 32, 32),
  new THREE.MeshStandardMaterial({ color: statusColors[node.status] }),
);
```

## Dependencies

- `mcp>=1.26.0` - MCP SDK
- `langgraph>=0.4.0` - LangGraph for agent workflows
- `langchain-core>=0.3.0` - LangChain core utilities
- `uvicorn>=0.34.0` - ASGI server
- `starlette>=0.46.0` - CORS middleware

## Learn More

- [MCP Apps Specification](../../specification/2026-01-26/apps.mdx)
- [LangGraph Documentation](https://python.langchain.com/docs/langgraph)
- [Three.js Documentation](https://threejs.org/docs/)
