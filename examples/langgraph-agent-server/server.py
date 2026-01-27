#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.26.0",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
#     "langgraph>=0.4.0",
#     "langchain-core>=0.3.0",
# ]
# ///
"""
LangGraph Agent Visualizer - MCP App Demo

This MCP server demonstrates the MCP Apps UI extension with LangGraph.
It provides an interactive 3D force-directed graph visualization that shows
an AI agent's reasoning workflow in real-time.

Features:
- LangGraph-powered multi-step agent workflow
- Interactive 3D visualization of agent state graph
- Real-time streaming of agent thoughts and decisions
- Demonstrates MCP Apps structuredContent for rich data

Architecture:
- `analyze_topic` tool: Runs a LangGraph agent that analyzes a topic
- The agent graph has nodes: research -> analyze -> synthesize -> conclude
- The view shows the graph with animated transitions between states
- Uses Three.js for 3D force-directed graph visualization

Usage:
  # Start the MCP server (HTTP mode for basic-host)
  python server.py

  # Or with stdio transport (for Claude Desktop)
  python server.py --stdio
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Annotated, Literal, TypedDict
from enum import Enum

import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp import types
from starlette.middleware.cors import CORSMiddleware

# LangGraph imports
from langgraph.graph import StateGraph, END

VIEW_URI = "ui://langgraph-agent/view.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3002"))

mcp = FastMCP("LangGraph Agent Visualizer", stateless_http=True)


# =============================================================================
# Agent State Types
# =============================================================================

class NodeStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class GraphNode:
    """Represents a node in the agent graph visualization."""
    id: str
    label: str
    status: str = "pending"
    description: str = ""
    output: str = ""
    duration_ms: float = 0
    x: float = 0  # 3D position
    y: float = 0
    z: float = 0


@dataclass
class GraphEdge:
    """Represents an edge in the agent graph."""
    source: str
    target: str
    active: bool = False


@dataclass
class AgentGraph:
    """The complete agent graph state for visualization."""
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    current_node: str | None = None
    topic: str = ""
    final_summary: str = ""
    started_at: str = ""
    completed_at: str = ""

    def to_dict(self) -> dict:
        return {
            "nodes": [asdict(n) for n in self.nodes],
            "edges": [asdict(e) for e in self.edges],
            "currentNode": self.current_node,
            "topic": self.topic,
            "finalSummary": self.final_summary,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


# =============================================================================
# LangGraph Agent Definition
# =============================================================================

class AgentState(TypedDict):
    """State that flows through the LangGraph."""
    topic: str
    research_output: str
    analysis_output: str
    synthesis_output: str
    conclusion: str
    current_step: str
    graph_updates: list[dict]  # Track updates for visualization


def create_agent_graph() -> StateGraph:
    """Create the LangGraph agent workflow."""

    def research_node(state: AgentState) -> AgentState:
        """Research phase: gather information about the topic."""
        topic = state["topic"]

        # Simulate research with interesting outputs
        research_findings = [
            f"Historical context: The concept of '{topic}' has evolved significantly over time.",
            f"Current trends: Modern approaches to '{topic}' emphasize innovation and sustainability.",
            f"Key players: Leading organizations are investing heavily in '{topic}' research.",
            f"Challenges: Common obstacles include scalability, adoption, and integration.",
        ]

        output = "\n".join(f"- {finding}" for finding in research_findings)

        return {
            **state,
            "research_output": output,
            "current_step": "research",
            "graph_updates": state["graph_updates"] + [{
                "node": "research",
                "status": "completed",
                "output": output,
            }],
        }

    def analyze_node(state: AgentState) -> AgentState:
        """Analysis phase: examine research findings."""
        topic = state["topic"]
        research = state["research_output"]

        analysis = f"""Based on research about "{topic}":

**Strengths:**
- Strong foundation in existing methodologies
- Growing interest and investment
- Clear value proposition

**Weaknesses:**
- Implementation complexity
- Resource requirements
- Learning curve

**Opportunities:**
- Emerging technologies can accelerate adoption
- Cross-domain applications possible
- Market demand is increasing

**Threats:**
- Competitive alternatives
- Regulatory uncertainty
- Technical limitations"""

        return {
            **state,
            "analysis_output": analysis,
            "current_step": "analyze",
            "graph_updates": state["graph_updates"] + [{
                "node": "analyze",
                "status": "completed",
                "output": analysis,
            }],
        }

    def synthesize_node(state: AgentState) -> AgentState:
        """Synthesis phase: combine insights."""
        topic = state["topic"]

        synthesis = f"""Synthesized insights for "{topic}":

The research reveals a dynamic landscape where {topic} is positioned
at an inflection point. Key success factors include:

1. **Integration Strategy**: Seamless integration with existing systems
2. **User Experience**: Focus on accessibility and intuitive interfaces
3. **Scalability**: Architecture that grows with demand
4. **Community**: Building ecosystem and knowledge sharing

The SWOT analysis indicates favorable conditions for strategic
investment, with manageable risks and significant upside potential."""

        return {
            **state,
            "synthesis_output": synthesis,
            "current_step": "synthesize",
            "graph_updates": state["graph_updates"] + [{
                "node": "synthesize",
                "status": "completed",
                "output": synthesis,
            }],
        }

    def conclude_node(state: AgentState) -> AgentState:
        """Conclusion phase: final recommendations."""
        topic = state["topic"]

        conclusion = f"""# Final Analysis: {topic}

## Executive Summary
After comprehensive analysis, {topic} demonstrates strong potential
for positive impact and ROI when approached strategically.

## Key Recommendations
1. Start with pilot projects to validate assumptions
2. Invest in team training and capability building
3. Establish metrics for measuring success
4. Plan for iterative improvement cycles

## Next Steps
- Define clear objectives and success criteria
- Identify quick wins for early momentum
- Build stakeholder alignment and support
- Create detailed implementation roadmap

*Analysis completed successfully.*"""

        return {
            **state,
            "conclusion": conclusion,
            "current_step": "conclude",
            "graph_updates": state["graph_updates"] + [{
                "node": "conclude",
                "status": "completed",
                "output": conclusion,
            }],
        }

    # Build the graph
    workflow = StateGraph(AgentState)

    # Add nodes
    workflow.add_node("research", research_node)
    workflow.add_node("analyze", analyze_node)
    workflow.add_node("synthesize", synthesize_node)
    workflow.add_node("conclude", conclude_node)

    # Define edges (linear flow for this demo)
    workflow.set_entry_point("research")
    workflow.add_edge("research", "analyze")
    workflow.add_edge("analyze", "synthesize")
    workflow.add_edge("synthesize", "conclude")
    workflow.add_edge("conclude", END)

    return workflow.compile()


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool(meta={
    "ui": {"resourceUri": VIEW_URI},
    "ui/resourceUri": VIEW_URI,  # legacy support
})
def analyze_topic(
    topic: Annotated[str, "The topic to analyze (e.g., 'machine learning', 'renewable energy')"] = "artificial intelligence",
) -> list[types.TextContent]:
    """Analyze a topic using a multi-step AI agent workflow.

    This tool runs a LangGraph agent that performs:
    1. Research - Gather information about the topic
    2. Analyze - Perform SWOT analysis
    3. Synthesize - Combine insights
    4. Conclude - Generate recommendations

    The UI shows an interactive 3D visualization of the agent's workflow.
    """
    # Create initial graph structure for visualization
    graph = AgentGraph(
        topic=topic,
        started_at=datetime.now().isoformat(),
        nodes=[
            GraphNode(id="research", label="Research", description="Gathering information", x=-2, y=1, z=0),
            GraphNode(id="analyze", label="Analyze", description="SWOT analysis", x=-0.7, y=0, z=0.5),
            GraphNode(id="synthesize", label="Synthesize", description="Combining insights", x=0.7, y=0, z=-0.5),
            GraphNode(id="conclude", label="Conclude", description="Final recommendations", x=2, y=-1, z=0),
        ],
        edges=[
            GraphEdge(source="research", target="analyze"),
            GraphEdge(source="analyze", target="synthesize"),
            GraphEdge(source="synthesize", target="conclude"),
        ],
    )

    # Run the LangGraph agent
    agent = create_agent_graph()
    initial_state: AgentState = {
        "topic": topic,
        "research_output": "",
        "analysis_output": "",
        "synthesis_output": "",
        "conclusion": "",
        "current_step": "",
        "graph_updates": [],
    }

    # Execute the graph
    final_state = agent.invoke(initial_state)

    # Update graph nodes with results
    for update in final_state["graph_updates"]:
        for node in graph.nodes:
            if node.id == update["node"]:
                node.status = update["status"]
                node.output = update["output"]

    graph.current_node = "conclude"
    graph.final_summary = final_state["conclusion"]
    graph.completed_at = datetime.now().isoformat()

    # Return both text content (for model) and structured content (for UI)
    text_summary = f"""Agent Analysis Complete for "{topic}"

The agent workflow executed 4 steps:
1. Research - Gathered background information
2. Analyze - Performed SWOT analysis
3. Synthesize - Combined insights
4. Conclude - Generated recommendations

{final_state["conclusion"]}"""

    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text_summary)],
        structuredContent=graph.to_dict(),
    )


@mcp.tool(meta={"ui": {"visibility": ["app"]}})
def get_agent_info() -> list[types.TextContent]:
    """Get information about the LangGraph agent (UI-only tool).

    Returns details about the agent's capabilities and workflow structure.
    """
    info = {
        "name": "Topic Analyzer Agent",
        "framework": "LangGraph",
        "version": "1.0.0",
        "workflow": {
            "nodes": ["research", "analyze", "synthesize", "conclude"],
            "description": "Multi-step analysis workflow for any topic",
        },
        "capabilities": [
            "Research gathering",
            "SWOT analysis",
            "Insight synthesis",
            "Recommendation generation",
        ],
    }
    return [types.TextContent(type="text", text=json.dumps(info, indent=2))]


# =============================================================================
# View Resource
# =============================================================================

EMBEDDED_VIEW_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>LangGraph Agent Visualizer</title>
  <script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.170.0",
      "three/addons/": "https://esm.sh/three@0.170.0/examples/jsm/",
      "@modelcontextprotocol/ext-apps": "https://esm.sh/@modelcontextprotocol/ext-apps@0.4.1?deps=zod@3.25.1"
    }
  }
  </script>
  <style>
    :root {
      --bg-primary: #0a0a1a;
      --bg-secondary: #1a1a2e;
      --text-primary: #e0e0e0;
      --text-secondary: #a0a0a0;
      --accent: #00d4ff;
      --accent-glow: rgba(0, 212, 255, 0.3);
      --node-pending: #4a4a6a;
      --node-active: #00d4ff;
      --node-completed: #00ff88;
      --node-error: #ff4466;
      --edge-default: #3a3a5a;
      --edge-active: #00d4ff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      overflow: hidden;
    }
    .container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100vw;
    }
    .header {
      padding: 16px 24px;
      background: linear-gradient(180deg, var(--bg-secondary) 0%, transparent 100%);
      z-index: 10;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header h1::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--accent-glow);
    }
    .topic {
      font-size: 14px;
      color: var(--text-secondary);
    }
    .canvas-container {
      flex: 1;
      position: relative;
    }
    #canvas3d {
      width: 100%;
      height: 100%;
      display: block;
    }
    .sidebar {
      position: absolute;
      right: 16px;
      top: 16px;
      bottom: 16px;
      width: 320px;
      background: rgba(26, 26, 46, 0.95);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      backdrop-filter: blur(10px);
    }
    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-weight: 600;
      color: var(--accent);
    }
    .node-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .node-item {
      padding: 12px;
      margin-bottom: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      border-left: 3px solid var(--node-pending);
      transition: all 0.3s ease;
    }
    .node-item.active {
      border-left-color: var(--node-active);
      background: rgba(0, 212, 255, 0.1);
    }
    .node-item.completed {
      border-left-color: var(--node-completed);
    }
    .node-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .node-name {
      font-weight: 600;
      font-size: 14px;
    }
    .node-status {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .node-status.pending { background: var(--node-pending); color: #fff; }
    .node-status.active { background: var(--node-active); color: #000; }
    .node-status.completed { background: var(--node-completed); color: #000; }
    .node-description {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .node-output {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 4px;
      max-height: 100px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: monospace;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      gap: 16px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--bg-secondary);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .status-bar {
      padding: 12px 24px;
      background: var(--bg-secondary);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--node-completed);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="spinner"></div>
      <div>Connecting to agent...</div>
    </div>
  </div>

  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { App } from '@modelcontextprotocol/ext-apps';

    // Initialize MCP App connection
    const app = new App({ name: 'LangGraph Visualizer', version: '1.0.0' });

    let graphData = null;
    let scene, camera, renderer, controls;
    let nodeObjects = {};
    let edgeObjects = [];
    let animationId;

    // Color mappings
    const statusColors = {
      pending: 0x4a4a6a,
      active: 0x00d4ff,
      completed: 0x00ff88,
      error: 0xff4466,
    };

    function initThreeJS() {
      const container = document.querySelector('.canvas-container');
      if (!container) return;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a1a);

      camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(0, 2, 6);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);

      const canvas = renderer.domElement;
      canvas.id = 'canvas3d';
      container.appendChild(canvas);

      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 3;
      controls.maxDistance = 15;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0x404060);
      scene.add(ambientLight);

      const pointLight = new THREE.PointLight(0x00d4ff, 1, 20);
      pointLight.position.set(0, 5, 5);
      scene.add(pointLight);

      const pointLight2 = new THREE.PointLight(0x00ff88, 0.5, 20);
      pointLight2.position.set(-5, -3, -5);
      scene.add(pointLight2);

      // Grid helper
      const gridHelper = new THREE.GridHelper(10, 20, 0x1a1a2e, 0x1a1a2e);
      gridHelper.position.y = -2;
      scene.add(gridHelper);

      window.addEventListener('resize', onWindowResize);
      animate();
    }

    function createNodeMesh(node) {
      const geometry = new THREE.SphereGeometry(0.3, 32, 32);
      const material = new THREE.MeshStandardMaterial({
        color: statusColors[node.status] || statusColors.pending,
        emissive: statusColors[node.status] || statusColors.pending,
        emissiveIntensity: 0.3,
        metalness: 0.5,
        roughness: 0.3,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(node.x, node.y, node.z);
      mesh.userData = { nodeId: node.id };

      // Add glow effect for active nodes
      if (node.status === 'active') {
        const glowGeometry = new THREE.SphereGeometry(0.5, 32, 32);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: 0x00d4ff,
          transparent: true,
          opacity: 0.2,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        mesh.add(glow);
      }

      return mesh;
    }

    function createEdgeLine(edge, nodes) {
      const sourceNode = nodes.find(n => n.id === edge.source);
      const targetNode = nodes.find(n => n.id === edge.target);

      if (!sourceNode || !targetNode) return null;

      const points = [
        new THREE.Vector3(sourceNode.x, sourceNode.y, sourceNode.z),
        new THREE.Vector3(targetNode.x, targetNode.y, targetNode.z),
      ];

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: edge.active ? 0x00d4ff : 0x3a3a5a,
        linewidth: 2,
      });

      return new THREE.Line(geometry, material);
    }

    function updateGraph(data) {
      if (!scene) return;

      // Clear existing objects
      Object.values(nodeObjects).forEach(obj => scene.remove(obj));
      edgeObjects.forEach(obj => scene.remove(obj));
      nodeObjects = {};
      edgeObjects = [];

      // Create edges first (so they're behind nodes)
      data.edges.forEach(edge => {
        const line = createEdgeLine(edge, data.nodes);
        if (line) {
          scene.add(line);
          edgeObjects.push(line);
        }
      });

      // Create nodes
      data.nodes.forEach(node => {
        const mesh = createNodeMesh(node);
        scene.add(mesh);
        nodeObjects[node.id] = mesh;
      });
    }

    function animate() {
      animationId = requestAnimationFrame(animate);

      // Animate active nodes
      Object.values(nodeObjects).forEach(mesh => {
        if (mesh.children.length > 0) {
          // Pulse glow effect
          const glow = mesh.children[0];
          glow.scale.setScalar(1 + 0.1 * Math.sin(Date.now() * 0.005));
        }
      });

      controls?.update();
      renderer?.render(scene, camera);
    }

    function onWindowResize() {
      const container = document.querySelector('.canvas-container');
      if (!container || !camera || !renderer) return;

      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }

    function renderUI(data) {
      const root = document.getElementById('root');

      if (!data) {
        root.innerHTML = `
          <div class="loading">
            <div class="spinner"></div>
            <div>Waiting for agent analysis...</div>
          </div>
        `;
        return;
      }

      root.innerHTML = `
        <div class="container">
          <div class="header">
            <h1>LangGraph Agent Visualizer</h1>
            <div class="topic">Analyzing: "${data.topic || 'Unknown topic'}"</div>
          </div>
          <div class="canvas-container"></div>
          <div class="sidebar">
            <div class="sidebar-header">Workflow Steps</div>
            <div class="node-list">
              ${data.nodes.map(node => `
                <div class="node-item ${node.status}">
                  <div class="node-item-header">
                    <span class="node-name">${node.label}</span>
                    <span class="node-status ${node.status}">${node.status}</span>
                  </div>
                  <div class="node-description">${node.description}</div>
                  ${node.output ? `<div class="node-output">${node.output.substring(0, 200)}${node.output.length > 200 ? '...' : ''}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
          <div class="status-bar">
            <div class="status-indicator">
              <div class="status-dot"></div>
              <span>Agent workflow ${data.completedAt ? 'completed' : 'running'}</span>
            </div>
            <div>LangGraph + MCP Apps Demo</div>
          </div>
        </div>
      `;

      // Initialize Three.js after DOM update
      setTimeout(() => {
        initThreeJS();
        if (data) {
          updateGraph(data);
        }
      }, 0);
    }

    // MCP App event handlers
    app.ontoolresult = (result) => {
      console.log('Tool result received:', result);

      if (result.structuredContent) {
        graphData = result.structuredContent;
        renderUI(graphData);
      }
    };

    app.ontoolinput = (params) => {
      console.log('Tool input received:', params);
      // Show loading state while analysis runs
      renderUI(null);
    };

    app.onhostcontextchanged = (ctx) => {
      console.log('Host context changed:', ctx);
    };

    // Connect to host
    app.connect().then(() => {
      console.log('Connected to MCP host');
      renderUI(null);
    }).catch(err => {
      console.error('Connection failed:', err);
      document.getElementById('root').innerHTML = `
        <div class="loading">
          <div style="color: #ff4466;">Connection failed: ${err.message}</div>
        </div>
      `;
    });
  </script>
</body>
</html>"""


@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://esm.sh"]}}},
)
def view() -> str:
    """View HTML resource with CSP metadata for external dependencies."""
    return EMBEDDED_VIEW_HTML


# =============================================================================
# Main
# =============================================================================

if __name__ == "__main__":
    if "--stdio" in sys.argv:
        # Claude Desktop mode
        mcp.run(transport="stdio")
    else:
        # HTTP mode for basic-host
        app = mcp.streamable_http_app()
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        print(f"LangGraph Agent Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)
