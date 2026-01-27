# ADK Financial Analytics Dashboard

An MCP Apps demo showcasing **Google ADK** (Agent Development Kit) integration with interactive financial data visualization.

## Overview

This demo demonstrates how to build an MCP server that:
1. Uses **Google ADK** patterns for AI-powered analysis
2. Provides **rich financial dashboards** through MCP Apps extension
3. Visualizes market data with **interactive D3.js charts**

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
│   │  Dashboard   │◄──────────────────►│  │  • Technical   │  │    │
│   │  (D3.js)     │                    │  │  • AI Insights │  │    │
│   │              │                    │  │  • Portfolio   │  │    │
│   └──────────────┘                    │  └────────────────┘  │    │
│                                       └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

### Financial Analysis
- **Portfolio Analysis**: Analyze multiple stocks simultaneously
- **Technical Indicators**: RSI, MACD, Bollinger Bands, Moving Averages
- **AI Insights**: Intelligent trading signals and recommendations
- **Historical Data**: 60+ days of OHLCV data

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

## Code Walkthrough

### Server Structure (`server.py`)

```python
# 1. Generate realistic stock data
def generate_stock_data(symbol: str, days: int = 60) -> list[dict]:
    # Returns OHLCV data for candlestick charts
    ...

# 2. Calculate technical indicators
def calculate_technical_indicators(data: list[dict]) -> dict:
    # RSI, MACD, Bollinger Bands, SMAs
    ...

# 3. Generate AI insights using ADK patterns
def generate_ai_insights(symbol: str, indicators: dict) -> list[dict]:
    # Trading signals based on technical analysis
    ...

# 4. Register MCP tool with UI metadata
@mcp.tool(meta={"ui": {"resourceUri": VIEW_URI}})
def analyze_portfolio(symbols: str, days: int):
    # Analyze portfolio and return structuredContent
    ...
```

### View Features (embedded HTML)

```javascript
// Interactive D3.js candlestick chart
function renderCandlestickChart(data) {
  // Candlestick bodies and wicks
  // Volume bars
  // SMA overlays
  // Interactive tooltips
}

// Handle MCP tool results
app.ontoolresult = (result) => {
  portfolioData = result.content[0]._meta.structuredContent;
  renderDashboard(portfolioData);
};
```

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
- `google-genai>=1.0.0` - Google ADK
- `uvicorn>=0.34.0` - ASGI server
- `starlette>=0.46.0` - CORS middleware

## Disclaimer

This demo uses **simulated data** for educational purposes only.
It is not financial advice and should not be used for actual trading decisions.

## Learn More

- [MCP Apps Specification](../../specification/2026-01-26/apps.mdx)
- [Google ADK Documentation](https://ai.google.dev/adk)
- [D3.js Documentation](https://d3js.org/)
- [Technical Analysis Guide](https://www.investopedia.com/technical-analysis-4689657)
