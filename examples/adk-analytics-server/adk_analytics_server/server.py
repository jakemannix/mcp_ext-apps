"""MCP server for ADK Financial Analytics with interactive dashboard."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Annotated

from mcp import types
from mcp.server.fastmcp import FastMCP

from .data import get_stock_data
from .indicators import calculate_technical_indicators, generate_ai_insights
from .logging import get_logger, log_tool_call, log_tool_result, setup_logging

VIEW_URI = "ui://adk-analytics/view.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3003"))

# Path to the static view HTML file
STATIC_DIR = Path(__file__).parent / "static"
VIEW_HTML_PATH = STATIC_DIR / "view.html"

mcp = FastMCP("ADK Financial Analytics", stateless_http=True)

# Module logger (configured in main())
logger = get_logger("server")


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
    start_time = time.perf_counter()
    log_tool_call(logger, "analyze_portfolio", {"symbols": symbols, "days": days})

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

    duration_ms = (time.perf_counter() - start_time) * 1000
    log_tool_result(
        logger,
        "analyze_portfolio",
        f"{len(symbol_list)} stocks, {len(all_insights)} insights, avg return {avg_change:+.2f}%",
        duration_ms,
        structured_content=portfolio_data,
    )

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
    start_time = time.perf_counter()
    log_tool_call(logger, "get_market_data", {"symbol": symbol, "days": days})

    data = get_stock_data(symbol, days)

    duration_ms = (time.perf_counter() - start_time) * 1000
    log_tool_result(logger, "get_market_data", f"{len(data)} data points", duration_ms)

    return [types.TextContent(type="text", text=json.dumps(data))]


@mcp.tool(meta={"ui": {"visibility": ["app"]}})
def technical_analysis(
    symbol: str = "AAPL",
    days: int = 60,
) -> list[types.TextContent]:
    """Calculate technical indicators for a stock (UI-only tool).

    Returns RSI, MACD, Bollinger Bands, and Moving Averages.
    """
    start_time = time.perf_counter()
    log_tool_call(logger, "technical_analysis", {"symbol": symbol, "days": days})

    data = get_stock_data(symbol, days)
    indicators = calculate_technical_indicators(data)

    duration_ms = (time.perf_counter() - start_time) * 1000
    log_tool_result(
        logger,
        "technical_analysis",
        f"RSI={indicators.get('rsi')}, price change={indicators.get('priceChangePercent')}%",
        duration_ms,
    )

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


# =============================================================================
# CLI
# =============================================================================


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="ADK Financial Analytics MCP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Start HTTP server with verbose logging (DEBUG level)
  python -m adk_analytics_server -v

  # Very verbose - includes full structuredContent in logs
  python -m adk_analytics_server -vv

  # Start with structured log file
  python -m adk_analytics_server --log-file /var/log/adk-analytics.jsonl

  # Start in STDIO mode for Claude Desktop
  python -m adk_analytics_server --stdio

  # Combine options
  python -m adk_analytics_server -vv --log-file debug.jsonl
        """,
    )

    parser.add_argument(
        "--stdio",
        action="store_true",
        help="Run in STDIO mode (for Claude Desktop)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="count",
        default=0,
        help="Increase verbosity (-v for DEBUG, -vv for TRACE with full structuredContent)",
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        metavar="PATH",
        help="Write structured JSON logs to file",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Base log level (default: INFO, overridden by --verbose)",
    )
    parser.add_argument(
        "--host",
        default=HOST,
        help=f"Host to bind to (default: {HOST})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help=f"Port to bind to (default: {PORT})",
    )

    return parser.parse_args()


def main() -> None:
    """Run the MCP server."""
    import uvicorn
    from starlette.middleware.cors import CORSMiddleware

    args = parse_args()

    # Set up logging
    setup_logging(
        verbosity=args.verbose,
        log_file=args.log_file,
        log_level=args.log_level,
    )

    logger.info("Starting ADK Financial Analytics Server")
    if args.verbose >= 2:
        logger.debug("Very verbose logging enabled (TRACE level, includes structuredContent)")
    elif args.verbose == 1:
        logger.debug("Verbose logging enabled (DEBUG level)")

    if args.stdio:
        # Claude Desktop mode
        logger.info("Running in STDIO mode")
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
        logger.info(f"Listening on http://{args.host}:{args.port}/mcp")
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
