"""MCP server for ADK Financial Analytics with interactive dashboard."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Annotated

from mcp import types
from mcp.server.fastmcp import FastMCP

from .data import get_stock_data
from .indicators import calculate_technical_indicators, generate_ai_insights

VIEW_URI = "ui://adk-analytics/view.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3003"))

# Path to the static view HTML file
STATIC_DIR = Path(__file__).parent / "static"
VIEW_HTML_PATH = STATIC_DIR / "view.html"

mcp = FastMCP("ADK Financial Analytics", stateless_http=True)


# =============================================================================
# MCP Tools
# =============================================================================


@mcp.tool(
    meta={
        "ui": {"resourceUri": VIEW_URI},
        "ui/resourceUri": VIEW_URI,  # legacy support
    }
)
def analyze_portfolio(
    symbols: Annotated[str, "Comma-separated stock symbols (e.g., 'AAPL,GOOGL,MSFT')"] = "AAPL,GOOGL,MSFT",
    days: Annotated[int, "Number of days of historical data (1-90)"] = 60,
) -> types.CallToolResult:
    """Analyze a stock portfolio using AI-powered financial analysis.

    This tool provides:
    - Historical price data with candlestick visualization
    - Technical indicators (RSI, MACD, Bollinger Bands, Moving Averages)
    - AI-generated insights and recommendations
    - Portfolio performance metrics

    The UI displays an interactive dashboard with charts and analysis.
    """
    symbol_list = [s.strip().upper() for s in symbols.split(",")][:5]  # Limit to 5 stocks

    portfolio_data = {
        "symbols": symbol_list,
        "analysisDate": datetime.now().isoformat(),
        "period": f"{days} days",
        "stocks": {},
        "summary": {},
    }

    total_change_pct = 0
    all_insights = []

    for symbol in symbol_list:
        stock_data = get_stock_data(symbol, days)
        indicators = calculate_technical_indicators(stock_data)
        insights = generate_ai_insights(symbol, indicators)

        portfolio_data["stocks"][symbol] = {
            "data": stock_data,
            "indicators": indicators,
            "insights": insights,
        }

        total_change_pct += indicators.get("priceChangePercent", 0)
        all_insights.extend(insights)

    # Portfolio summary
    avg_change = total_change_pct / len(symbol_list) if symbol_list else 0
    portfolio_data["summary"] = {
        "averageReturn": round(avg_change, 2),
        "stockCount": len(symbol_list),
        "insightCount": len(all_insights),
        "topInsight": all_insights[0] if all_insights else None,
    }

    # Generate text summary for LLM
    text_summary = f"""Portfolio Analysis Complete

**Stocks Analyzed:** {', '.join(symbol_list)}
**Period:** {days} days
**Average Return:** {avg_change:+.2f}%

**Key Insights:**
"""
    for insight in all_insights[:5]:
        text_summary += f"\n- [{insight['indicator']}] {insight['title']}: {insight['description']}"

    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text_summary)],
        structuredContent=portfolio_data,
    )


@mcp.tool(meta={"ui": {"visibility": ["app"]}})
def get_market_data(
    symbol: str = "AAPL",
    days: int = 60,
) -> list[types.TextContent]:
    """Get historical market data for a single stock (UI-only tool).

    Returns OHLCV data for charting.
    """
    data = get_stock_data(symbol, days)
    return [types.TextContent(type="text", text=json.dumps(data))]


@mcp.tool(meta={"ui": {"visibility": ["app"]}})
def technical_analysis(
    symbol: str = "AAPL",
    days: int = 60,
) -> list[types.TextContent]:
    """Calculate technical indicators for a stock (UI-only tool).

    Returns RSI, MACD, Bollinger Bands, and Moving Averages.
    """
    data = get_stock_data(symbol, days)
    indicators = calculate_technical_indicators(data)
    return [types.TextContent(type="text", text=json.dumps(indicators))]


# =============================================================================
# View Resource
# =============================================================================


@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://esm.sh", "https://cdn.jsdelivr.net"]}}},
)
def view() -> str:
    """View HTML resource with CSP metadata for external dependencies."""
    return VIEW_HTML_PATH.read_text()


def main() -> None:
    """Run the MCP server."""
    import sys

    import uvicorn
    from starlette.middleware.cors import CORSMiddleware

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
        print(f"ADK Financial Analytics Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()
