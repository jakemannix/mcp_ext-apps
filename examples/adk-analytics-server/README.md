# ADK Financial Analytics Dashboard

An MCP Apps demo showcasing **Google ADK** (Agent Development Kit) integration with interactive financial data visualization and real market data from **Tiingo**.

This project includes:
- **MCP Server**: Exposes financial analysis tools via MCP protocol
- **LLM Agent Server**: Conversational UI powered by Claude, OpenRouter, or Gemini

## Overview

This demo demonstrates how to build an MCP server that:

1. Uses **Google ADK** patterns for AI-powered analysis
2. Fetches **real market data** from Tiingo API
3. Provides **rich financial dashboards** through MCP Apps extension
4. Visualizes market data with **interactive D3.js charts**
5. Offers a conversational agent UI with multi-provider LLM support

## Screenshot

The dashboard features:

- Interactive candlestick charts with volume
- Technical indicators (RSI, MACD, SMA)
- AI-generated trading insights
- Multi-stock portfolio analysis

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP Apps Architecture                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌──────────────┐    MCP Protocol    ┌──────────────────────┐    │
│   │  Host Client │◄──────────────────►│  ADK Analytics       │    │
│   │  (Claude)    │                    │  Server              │    │
│   └──────┬───────┘                    │                      │    │
│          │                            │  ┌────────────────┐  │    │
│          │ iframe                     │  │   Analysis     │  │    │
│          ▼                            │  │   Engine       │  │    │
│   ┌──────────────┐    postMessage     │  │                │  │    │
│   │  Dashboard   │◄──────────────────►│  │  • Tiingo API  │  │    │
│   │  (D3.js)     │                    │  │  • Technical   │  │    │
│   │              │                    │  │  • AI Insights │  │    │
│   └──────────────┘                    │  └────────────────┘  │    │
│                                       └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## LLM Agent Mode

The agent server provides a chat UI where users can ask questions in natural language. The agent uses an LLM to understand requests, call MCP tools, and explain results.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Server (Port 3004)                      │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │  Chat UI     │◄──►│ LLM Agent    │◄──►│  MCP Client     │   │
│  │  (HTML/JS)   │SSE │ (ReAct loop) │    │  (HTTP)         │   │
│  └──────────────┘    └──────────────┘    └────────┬────────┘   │
└──────────────────────────────────────────────────│─────────────┘
                                                    │ HTTP
                                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server (Port 3003)                        │
│  analyze_portfolio │ get_market_data │ technical_analysis       │
└─────────────────────────────────────────────────────────────────┘
```

### LLM Provider Support

The agent auto-detects which provider to use based on available API keys:

| Priority | Provider | API Key Env Var | Default Model |
|----------|----------|-----------------|---------------|
| 1 | Anthropic | `ANTHROPIC_API_KEY` | claude-opus-4-5 |
| 2 | OpenRouter | `OPENROUTER_API_KEY` | anthropic/claude-3.5-sonnet |
| 3 | Google | `GOOGLE_API_KEY` | gemini-2.0-flash |

### Running the Agent

```bash
# Terminal 1: Start MCP server (required)
uv run python -m adk_analytics_server

# Terminal 2: Start agent server
uv run python -m adk_analytics_server agent

# Open http://localhost:3004 in your browser
```

### Example Conversations

- "What's the current state of AAPL stock?"
- "Analyze NVDA and TSLA over the past month"
- "Show me technical analysis for MSFT"
- "Compare the momentum of GOOGL vs META"

## Setup

### 1. Get a Tiingo API Key

Sign up for a free API key at [tiingo.com](https://www.tiingo.com/). The free tier includes:

- 500 requests/hour
- 30+ years of EOD stock data
- No delay on historical data

### 2. Configure Environment

Add your API tokens to the repository's `.env` file:

```bash
# Required: Market data
TIINGO_API_TOKEN=your_tiingo_token

# LLM Provider (set ONE of these for agent mode)
ANTHROPIC_API_KEY=your_anthropic_key  # Recommended
# OR
OPENROUTER_API_KEY=your_openrouter_key
MODEL_NAME=anthropic/claude-3.5-sonnet  # Optional, for OpenRouter
# OR
GOOGLE_API_KEY=your_google_key
```

The package automatically loads `.env` from the repository root.

## Usage

### Start the Server

```bash
# HTTP mode (for basic-host)
uv run python -m adk_analytics_server

# STDIO mode (for Claude Desktop)
uv run python -m adk_analytics_server --stdio

# With verbose logging (shows MCP calls, data fetches, timing)
uv run python -m adk_analytics_server -v

# Very verbose - includes full structuredContent in logs
uv run python -m adk_analytics_server -vv

# With structured JSON log file
uv run python -m adk_analytics_server --log-file analytics.jsonl

# Combine options (very verbose + log file for debugging)
uv run python -m adk_analytics_server -vv --log-file debug.jsonl
```

### CLI Options

| Option            | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `--stdio`         | Run in STDIO mode for Claude Desktop                         |
| `-v`              | Verbose logging (DEBUG level - tool calls, timing)           |
| `-vv`             | Very verbose (TRACE level - includes full structuredContent) |
| `--log-file PATH` | Write structured JSON logs to file                           |
| `--log-level`     | Base log level: DEBUG, INFO, WARNING, ERROR                  |
| `--host HOST`     | Host to bind to (default: 0.0.0.0)                           |
| `--port PORT`     | Port to bind to (default: 3003)                              |

### Connect with basic-host

1. Start the server: `uv run python -m adk_analytics_server`
2. Open basic-host at `http://localhost:8080`
3. Connect to `http://localhost:3003/mcp`
4. Call the `analyze_portfolio` tool

### Example Tool Calls

```json
{
  "name": "analyze_portfolio",
  "arguments": {
    "symbols": "AAPL,GOOGL,MSFT,NVDA",
    "days": 60
  }
}
```

## Project Structure

```
adk-analytics-server/
├── pyproject.toml              # Package configuration
├── package.json                # npm workspace config
├── README.md
└── adk_analytics_server/       # Python package
    ├── __init__.py             # Loads .env, exports version
    ├── __main__.py             # CLI entry point (MCP server or agent)
    ├── data.py                 # Tiingo API integration
    ├── indicators.py           # RSI, MACD, Bollinger, AI insights
    ├── logging.py              # Structured logging configuration
    ├── server.py               # MCP server and tools
    ├── mcp_client.py           # HTTP client for MCP server
    ├── agent.py                # ReAct agent loop
    ├── agent_server.py         # HTTP server for agent UI
    ├── llm/                    # LLM provider abstraction
    │   ├── __init__.py
    │   ├── base.py             # Abstract provider interface
    │   ├── factory.py          # Provider auto-detection
    │   ├── anthropic.py        # Claude provider
    │   ├── openrouter.py       # OpenRouter provider
    │   └── google.py           # Gemini provider
    └── static/
        ├── view.html           # D3.js dashboard (MCP App view)
        └── agent_ui.html       # Chat UI for agent mode
```

## Code Walkthrough

### Data Module (`data.py`)

```python
# Fetch real market data from Tiingo
def fetch_stock_data_from_tiingo(symbol: str, days: int = 60) -> list[dict]:
    # Returns OHLCV data with adjusted prices
    # Raises TiingoConfigError if token not set
    # Raises TiingoAPIError on API failures with clear error messages
    ...

# Get data with caching (5-minute TTL)
def get_stock_data(symbol: str, days: int = 60) -> list[dict]:
    # Returns cached data if available, otherwise fetches from Tiingo
    ...
```

### Indicators Module (`indicators.py`)

```python
# Calculate technical indicators
def calculate_technical_indicators(data: list[dict]) -> dict:
    # RSI, MACD, Bollinger Bands, SMAs
    ...

# Generate AI-powered insights
def generate_ai_insights(symbol: str, indicators: dict) -> list[dict]:
    # Trading signals based on technical analysis
    ...
```

### Server Module (`server.py`)

```python
# Register MCP tool with UI metadata
@mcp.tool(meta={"ui": {"resourceUri": VIEW_URI}})
def analyze_portfolio(symbols: str, days: int):
    # Analyze portfolio and return structuredContent
    ...
```

### View (`static/view.html`)

```javascript
// Handle MCP tool results
app.ontoolresult = (result) => {
  portfolioData = result.structuredContent;
  renderDashboard(portfolioData);
};

// Interactive D3.js candlestick chart
function renderCandlestickChart(data) {
  // Candlestick bodies and wicks
  // Volume bars
  // SMA overlays
  // Interactive tooltips
}
```

## Features

### Financial Analysis

- **Portfolio Analysis**: Analyze multiple stocks simultaneously
- **Technical Indicators**: RSI, MACD, Bollinger Bands, Moving Averages
- **AI Insights**: Intelligent trading signals and recommendations
- **Real Market Data**: Live data from Tiingo (EOD, no delay)

### Interactive Visualization

- **Candlestick Charts**: Classic OHLC visualization with D3.js
- **Volume Analysis**: Volume bars synchronized with price action
- **Moving Averages**: SMA 20 and SMA 50 overlays
- **Multi-Stock Tabs**: Switch between analyzed stocks
- **Tooltips**: Detailed data on hover

### MCP Apps Integration

- `structuredContent` for rich portfolio data
- UI-only tools for interactive data fetching
- Proper CSP for D3.js external library

## Technical Indicators Explained

### RSI (Relative Strength Index)

- **> 70**: Overbought (potential sell signal)
- **< 30**: Oversold (potential buy signal)
- **30-70**: Neutral territory

### MACD (Moving Average Convergence Divergence)

- **Positive histogram**: Bullish momentum
- **Negative histogram**: Bearish momentum
- **Signal crossovers**: Trend change indicators

### Bollinger Bands

- **Above upper band**: Price overextended
- **Below lower band**: Potential reversal
- **Band squeeze**: Low volatility, breakout pending

### Moving Averages

- **SMA 20** (blue): Short-term trend
- **SMA 50** (yellow): Medium-term trend
- **Golden Cross**: SMA 20 crosses above SMA 50 (bullish)
- **Death Cross**: SMA 20 crosses below SMA 50 (bearish)

## Dependencies

- `mcp>=1.26.0` - MCP SDK
- `requests>=2.31.0` - HTTP client for Tiingo API
- `python-dotenv>=1.0.0` - Environment variable loading
- `uvicorn>=0.34.0` - ASGI server
- `starlette>=0.46.0` - CORS middleware
- `anthropic>=0.40.0` - Anthropic SDK (agent mode)
- `httpx>=0.27.0` - Async HTTP client (agent mode)
- `google-genai>=1.0.0` - Google Gemini SDK (agent mode)

## Disclaimer

This demo is for **educational purposes only**. It is not financial advice and should not be used for actual trading decisions. Market data is provided by Tiingo with a 15-20 minute delay on live quotes (EOD historical data has no delay).

## Learn More

- [MCP Apps Specification](../../specification/2026-01-26/apps.mdx)
- [Tiingo API Documentation](https://www.tiingo.com/documentation/general/overview)
- [Google ADK Documentation](https://ai.google.dev/adk)
- [D3.js Documentation](https://d3js.org/)
- [Technical Analysis Guide](https://www.investopedia.com/technical-analysis-4689657)
