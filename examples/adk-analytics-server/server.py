#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.26.0",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
#     "google-genai>=1.0.0",
# ]
# ///
"""
Google ADK Financial Analytics Dashboard - MCP App Demo

This MCP server demonstrates the MCP Apps UI extension with Google ADK (Agent Development Kit).
It provides an interactive financial analytics dashboard with real-time data visualization.

Features:
- Google ADK-powered financial analysis agent
- Interactive candlestick charts with D3.js
- Real-time portfolio analysis
- Technical indicators (RSI, MACD, Moving Averages)
- Demonstrates MCP Apps structuredContent for rich data

Architecture:
- `analyze_portfolio` tool: Analyzes a stock portfolio with AI insights
- `get_market_data` tool: Returns simulated market data for visualization
- `technical_analysis` tool: Calculates technical indicators
- The view shows an interactive dashboard with multiple chart types

Usage:
  # Start the MCP server (HTTP mode for basic-host)
  python server.py

  # Or with stdio transport (for Claude Desktop)
  python server.py --stdio
"""
from __future__ import annotations
import asyncio
import json
import math
import os
import random
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Annotated, Literal
from enum import Enum

import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp import types
from starlette.middleware.cors import CORSMiddleware

VIEW_URI = "ui://adk-analytics/view.html"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3003"))

mcp = FastMCP("ADK Financial Analytics", stateless_http=True)


# =============================================================================
# Data Generation
# =============================================================================

def generate_stock_data(symbol: str, days: int = 60) -> list[dict]:
    """Generate realistic-looking stock price data."""
    random.seed(hash(symbol) % 1000)  # Consistent data per symbol

    # Starting price based on symbol
    base_prices = {
        "AAPL": 178.0,
        "GOOGL": 141.0,
        "MSFT": 378.0,
        "AMZN": 178.0,
        "NVDA": 875.0,
        "TSLA": 248.0,
        "META": 505.0,
    }
    price = base_prices.get(symbol, 100.0)

    data = []
    volatility = 0.02
    trend = random.uniform(-0.001, 0.002)

    now = datetime.now()

    for i in range(days):
        date = now - timedelta(days=days - i - 1)

        # Generate OHLCV data
        daily_return = random.gauss(trend, volatility)
        open_price = price
        close_price = price * (1 + daily_return)

        # High and low within the day
        intraday_vol = abs(random.gauss(0, volatility * 0.5))
        high = max(open_price, close_price) * (1 + intraday_vol)
        low = min(open_price, close_price) * (1 - intraday_vol)

        # Volume (higher on volatile days)
        base_volume = random.randint(10_000_000, 50_000_000)
        volume = int(base_volume * (1 + abs(daily_return) * 10))

        data.append({
            "date": date.strftime("%Y-%m-%d"),
            "timestamp": int(date.timestamp() * 1000),
            "open": round(open_price, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "close": round(close_price, 2),
            "volume": volume,
        })

        price = close_price

    return data


def calculate_technical_indicators(data: list[dict]) -> dict:
    """Calculate technical indicators for the stock data."""
    closes = [d["close"] for d in data]

    # Simple Moving Averages
    def sma(prices, period):
        if len(prices) < period:
            return None
        return sum(prices[-period:]) / period

    # RSI
    def calculate_rsi(prices, period=14):
        if len(prices) < period + 1:
            return None
        gains = []
        losses = []
        for i in range(1, len(prices)):
            change = prices[i] - prices[i-1]
            gains.append(max(0, change))
            losses.append(max(0, -change))
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 2)

    # MACD
    def calculate_macd(prices):
        if len(prices) < 26:
            return None, None, None
        ema12 = sum(prices[-12:]) / 12  # Simplified
        ema26 = sum(prices[-26:]) / 26  # Simplified
        macd_line = ema12 - ema26
        signal = macd_line * 0.9  # Simplified signal line
        histogram = macd_line - signal
        return round(macd_line, 4), round(signal, 4), round(histogram, 4)

    # Bollinger Bands
    def bollinger_bands(prices, period=20):
        if len(prices) < period:
            return None, None, None
        sma_val = sum(prices[-period:]) / period
        variance = sum((p - sma_val) ** 2 for p in prices[-period:]) / period
        std_dev = math.sqrt(variance)
        return round(sma_val - 2 * std_dev, 2), round(sma_val, 2), round(sma_val + 2 * std_dev, 2)

    macd_line, macd_signal, macd_histogram = calculate_macd(closes)
    bb_lower, bb_middle, bb_upper = bollinger_bands(closes)

    return {
        "sma20": round(sma(closes, 20), 2) if sma(closes, 20) else None,
        "sma50": round(sma(closes, 50), 2) if sma(closes, 50) else None,
        "rsi": calculate_rsi(closes),
        "macd": {
            "line": macd_line,
            "signal": macd_signal,
            "histogram": macd_histogram,
        },
        "bollingerBands": {
            "lower": bb_lower,
            "middle": bb_middle,
            "upper": bb_upper,
        },
        "currentPrice": closes[-1] if closes else None,
        "priceChange": round(closes[-1] - closes[0], 2) if len(closes) > 1 else 0,
        "priceChangePercent": round((closes[-1] - closes[0]) / closes[0] * 100, 2) if len(closes) > 1 else 0,
    }


def generate_ai_insights(symbol: str, indicators: dict) -> list[dict]:
    """Generate AI-powered insights using Google ADK patterns."""
    insights = []

    # RSI insight
    rsi = indicators.get("rsi")
    if rsi:
        if rsi > 70:
            insights.append({
                "type": "warning",
                "indicator": "RSI",
                "title": "Overbought Signal",
                "description": f"RSI at {rsi} indicates overbought conditions. Consider taking profits or waiting for a pullback.",
                "confidence": 0.75,
            })
        elif rsi < 30:
            insights.append({
                "type": "opportunity",
                "indicator": "RSI",
                "title": "Oversold Signal",
                "description": f"RSI at {rsi} indicates oversold conditions. Potential buying opportunity if fundamentals are strong.",
                "confidence": 0.72,
            })
        else:
            insights.append({
                "type": "neutral",
                "indicator": "RSI",
                "title": "Neutral Momentum",
                "description": f"RSI at {rsi} is in neutral territory. No strong momentum signals.",
                "confidence": 0.68,
            })

    # MACD insight
    macd = indicators.get("macd", {})
    if macd.get("histogram"):
        if macd["histogram"] > 0:
            insights.append({
                "type": "bullish",
                "indicator": "MACD",
                "title": "Bullish Momentum",
                "description": "MACD histogram is positive, indicating bullish momentum. The trend may continue upward.",
                "confidence": 0.70,
            })
        else:
            insights.append({
                "type": "bearish",
                "indicator": "MACD",
                "title": "Bearish Momentum",
                "description": "MACD histogram is negative, indicating bearish momentum. Watch for potential reversal signals.",
                "confidence": 0.70,
            })

    # Price change insight
    change_pct = indicators.get("priceChangePercent", 0)
    if abs(change_pct) > 10:
        insights.append({
            "type": "alert",
            "indicator": "Price",
            "title": f"Significant {'Gain' if change_pct > 0 else 'Loss'}",
            "description": f"Stock has moved {abs(change_pct):.1f}% over the analysis period. High volatility detected.",
            "confidence": 0.85,
        })

    # Bollinger Band insight
    bb = indicators.get("bollingerBands", {})
    current = indicators.get("currentPrice")
    if bb.get("upper") and current:
        if current > bb["upper"]:
            insights.append({
                "type": "warning",
                "indicator": "Bollinger Bands",
                "title": "Above Upper Band",
                "description": "Price is trading above the upper Bollinger Band. May indicate overextension.",
                "confidence": 0.65,
            })
        elif current < bb["lower"]:
            insights.append({
                "type": "opportunity",
                "indicator": "Bollinger Bands",
                "title": "Below Lower Band",
                "description": "Price is trading below the lower Bollinger Band. Potential mean reversion opportunity.",
                "confidence": 0.65,
            })

    return insights


# =============================================================================
# MCP Tools
# =============================================================================

@mcp.tool(meta={
    "ui": {"resourceUri": VIEW_URI},
    "ui/resourceUri": VIEW_URI,  # legacy support
})
def analyze_portfolio(
    symbols: Annotated[str, "Comma-separated stock symbols (e.g., 'AAPL,GOOGL,MSFT')"] = "AAPL,GOOGL,MSFT",
    days: Annotated[int, "Number of days of historical data (1-90)"] = 60,
) -> list[types.TextContent]:
    """Analyze a stock portfolio using AI-powered financial analysis.

    This tool uses Google ADK patterns to provide:
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
        # Generate stock data
        stock_data = generate_stock_data(symbol, days)
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
    data = generate_stock_data(symbol, days)
    return [types.TextContent(type="text", text=json.dumps(data))]


@mcp.tool(meta={"ui": {"visibility": ["app"]}})
def technical_analysis(
    symbol: str = "AAPL",
    days: int = 60,
) -> list[types.TextContent]:
    """Calculate technical indicators for a stock (UI-only tool).

    Returns RSI, MACD, Bollinger Bands, and Moving Averages.
    """
    data = generate_stock_data(symbol, days)
    indicators = calculate_technical_indicators(data)
    return [types.TextContent(type="text", text=json.dumps(indicators))]


# =============================================================================
# View Resource
# =============================================================================

EMBEDDED_VIEW_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>ADK Financial Analytics</title>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
  <script type="importmap">
  {
    "imports": {
      "@modelcontextprotocol/ext-apps": "https://esm.sh/@modelcontextprotocol/ext-apps@0.4.1?deps=zod@3.25.1"
    }
  }
  </script>
  <style>
    :root {
      --bg-primary: #0f1419;
      --bg-secondary: #192029;
      --bg-card: #1c2632;
      --text-primary: #e7e9ea;
      --text-secondary: #8b98a5;
      --accent: #1d9bf0;
      --success: #00ba7c;
      --warning: #ffad1f;
      --danger: #f4212e;
      --chart-green: #00c853;
      --chart-red: #ff1744;
      --grid-color: #2f3336;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
    }
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 300px;
      grid-template-rows: auto 1fr auto;
      gap: 16px;
      padding: 16px;
      min-height: 100vh;
      max-width: 1600px;
      margin: 0 auto;
    }
    .header {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: var(--bg-secondary);
      border-radius: 12px;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header h1::before {
      content: '📊';
    }
    .header-stats {
      display: flex;
      gap: 24px;
    }
    .stat {
      text-align: right;
    }
    .stat-label {
      font-size: 11px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 600;
    }
    .stat-value.positive { color: var(--success); }
    .stat-value.negative { color: var(--danger); }
    .main-chart {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 20px;
      overflow: hidden;
    }
    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .chart-title {
      font-size: 16px;
      font-weight: 600;
    }
    .symbol-tabs {
      display: flex;
      gap: 8px;
    }
    .symbol-tab {
      padding: 6px 12px;
      border: none;
      background: var(--bg-secondary);
      color: var(--text-secondary);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .symbol-tab:hover {
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    .symbol-tab.active {
      background: var(--accent);
      color: white;
    }
    .chart-container {
      height: 350px;
      position: relative;
    }
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .card {
      background: var(--bg-card);
      border-radius: 12px;
      padding: 16px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .indicators-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .indicator {
      background: var(--bg-secondary);
      padding: 12px;
      border-radius: 8px;
    }
    .indicator-label {
      font-size: 11px;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .indicator-value {
      font-size: 18px;
      font-weight: 600;
    }
    .indicator-value.overbought { color: var(--danger); }
    .indicator-value.oversold { color: var(--success); }
    .indicator-value.neutral { color: var(--text-primary); }
    .insights-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .insight {
      padding: 12px;
      background: var(--bg-secondary);
      border-radius: 8px;
      border-left: 3px solid var(--accent);
    }
    .insight.warning { border-left-color: var(--warning); }
    .insight.opportunity { border-left-color: var(--success); }
    .insight.bearish { border-left-color: var(--danger); }
    .insight.bullish { border-left-color: var(--success); }
    .insight.alert { border-left-color: var(--danger); }
    .insight-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .insight-title {
      font-size: 13px;
      font-weight: 600;
    }
    .insight-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--accent);
      color: white;
    }
    .insight-desc {
      font-size: 12px;
      color: var(--text-secondary);
    }
    .footer {
      grid-column: 1 / -1;
      text-align: center;
      padding: 12px;
      font-size: 12px;
      color: var(--text-secondary);
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
      width: 48px;
      height: 48px;
      border: 4px solid var(--bg-secondary);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .candlestick-up { fill: var(--chart-green); }
    .candlestick-down { fill: var(--chart-red); }
    .candlestick-wick { stroke-width: 1; }
    .candlestick-wick.up { stroke: var(--chart-green); }
    .candlestick-wick.down { stroke: var(--chart-red); }
    .volume-bar { opacity: 0.5; }
    .volume-bar.up { fill: var(--chart-green); }
    .volume-bar.down { fill: var(--chart-red); }
    .axis text { fill: var(--text-secondary); font-size: 11px; }
    .axis path, .axis line { stroke: var(--grid-color); }
    .grid line { stroke: var(--grid-color); stroke-opacity: 0.3; }
    .sma-line { fill: none; stroke-width: 1.5; }
    .sma-20 { stroke: var(--accent); }
    .sma-50 { stroke: var(--warning); }
    .tooltip {
      position: absolute;
      background: var(--bg-secondary);
      border: 1px solid var(--grid-color);
      border-radius: 8px;
      padding: 12px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 100;
    }
    .tooltip.visible { opacity: 1; }
    .tooltip-row { display: flex; justify-content: space-between; gap: 16px; }
    .tooltip-label { color: var(--text-secondary); }
  </style>
</head>
<body>
  <div id="root">
    <div class="loading">
      <div class="spinner"></div>
      <div>Connecting to ADK Analytics...</div>
    </div>
  </div>

  <script type="module">
    import { App } from '@modelcontextprotocol/ext-apps';

    const app = new App({ name: 'ADK Financial Analytics', version: '1.0.0' });

    let portfolioData = null;
    let selectedSymbol = null;

    function renderDashboard(data) {
      if (!data || !data.stocks) return;

      const symbols = Object.keys(data.stocks);
      if (!selectedSymbol || !symbols.includes(selectedSymbol)) {
        selectedSymbol = symbols[0];
      }

      const stock = data.stocks[selectedSymbol];
      const indicators = stock.indicators;
      const avgReturn = data.summary?.averageReturn || 0;

      document.getElementById('root').innerHTML = `
        <div class="dashboard">
          <header class="header">
            <h1>ADK Financial Analytics</h1>
            <div class="header-stats">
              <div class="stat">
                <div class="stat-label">Portfolio Return</div>
                <div class="stat-value ${avgReturn >= 0 ? 'positive' : 'negative'}">${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%</div>
              </div>
              <div class="stat">
                <div class="stat-label">Analysis Date</div>
                <div class="stat-value">${new Date(data.analysisDate).toLocaleDateString()}</div>
              </div>
            </div>
          </header>

          <main class="main-chart">
            <div class="chart-header">
              <div class="chart-title">${selectedSymbol} Price Chart</div>
              <div class="symbol-tabs">
                ${symbols.map(s => `
                  <button class="symbol-tab ${s === selectedSymbol ? 'active' : ''}" data-symbol="${s}">${s}</button>
                `).join('')}
              </div>
            </div>
            <div class="chart-container" id="candlestick-chart"></div>
            <div class="tooltip" id="chart-tooltip"></div>
          </main>

          <aside class="sidebar">
            <div class="card">
              <div class="card-title">Technical Indicators</div>
              <div class="indicators-grid">
                <div class="indicator">
                  <div class="indicator-label">RSI (14)</div>
                  <div class="indicator-value ${indicators.rsi > 70 ? 'overbought' : indicators.rsi < 30 ? 'oversold' : 'neutral'}">${indicators.rsi || 'N/A'}</div>
                </div>
                <div class="indicator">
                  <div class="indicator-label">SMA 20</div>
                  <div class="indicator-value">$${indicators.sma20 || 'N/A'}</div>
                </div>
                <div class="indicator">
                  <div class="indicator-label">MACD</div>
                  <div class="indicator-value ${indicators.macd?.histogram > 0 ? 'positive' : 'negative'}">${indicators.macd?.line?.toFixed(2) || 'N/A'}</div>
                </div>
                <div class="indicator">
                  <div class="indicator-label">Change</div>
                  <div class="indicator-value ${indicators.priceChangePercent >= 0 ? 'positive' : 'negative'}">${indicators.priceChangePercent >= 0 ? '+' : ''}${indicators.priceChangePercent}%</div>
                </div>
              </div>
            </div>

            <div class="card" style="flex: 1; overflow-y: auto;">
              <div class="card-title">AI Insights</div>
              <div class="insights-list">
                ${stock.insights.map(insight => `
                  <div class="insight ${insight.type}">
                    <div class="insight-header">
                      <span class="insight-title">${insight.title}</span>
                      <span class="insight-badge">${insight.indicator}</span>
                    </div>
                    <div class="insight-desc">${insight.description}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          </aside>

          <footer class="footer">
            Powered by Google ADK + MCP Apps | Data is simulated for demonstration
          </footer>
        </div>
      `;

      // Add event listeners for symbol tabs
      document.querySelectorAll('.symbol-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          selectedSymbol = e.target.dataset.symbol;
          renderDashboard(portfolioData);
        });
      });

      // Render candlestick chart
      renderCandlestickChart(stock.data);
    }

    function renderCandlestickChart(data) {
      const container = document.getElementById('candlestick-chart');
      if (!container || !data || data.length === 0) return;

      // Clear previous chart
      container.innerHTML = '';

      const margin = { top: 20, right: 50, bottom: 50, left: 60 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = container.clientHeight - margin.top - margin.bottom;

      // Main chart height (80%) and volume height (20%)
      const chartHeight = height * 0.75;
      const volumeHeight = height * 0.2;
      const gap = height * 0.05;

      const svg = d3.select(container)
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom);

      const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      // Scales
      const x = d3.scaleBand()
        .domain(data.map(d => d.date))
        .range([0, width])
        .padding(0.3);

      const yPrice = d3.scaleLinear()
        .domain([
          d3.min(data, d => d.low) * 0.99,
          d3.max(data, d => d.high) * 1.01
        ])
        .range([chartHeight, 0]);

      const yVolume = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.volume)])
        .range([volumeHeight, 0]);

      // Grid
      g.append('g')
        .attr('class', 'grid')
        .call(d3.axisLeft(yPrice)
          .tickSize(-width)
          .tickFormat('')
        );

      // Volume bars
      const volumeGroup = g.append('g')
        .attr('transform', `translate(0,${chartHeight + gap})`);

      volumeGroup.selectAll('.volume-bar')
        .data(data)
        .join('rect')
        .attr('class', d => `volume-bar ${d.close >= d.open ? 'up' : 'down'}`)
        .attr('x', d => x(d.date))
        .attr('y', d => yVolume(d.volume))
        .attr('width', x.bandwidth())
        .attr('height', d => volumeHeight - yVolume(d.volume));

      // Candlesticks
      const candles = g.selectAll('.candle')
        .data(data)
        .join('g')
        .attr('class', 'candle');

      // Wicks
      candles.append('line')
        .attr('class', d => `candlestick-wick ${d.close >= d.open ? 'up' : 'down'}`)
        .attr('x1', d => x(d.date) + x.bandwidth() / 2)
        .attr('x2', d => x(d.date) + x.bandwidth() / 2)
        .attr('y1', d => yPrice(d.high))
        .attr('y2', d => yPrice(d.low));

      // Bodies
      candles.append('rect')
        .attr('class', d => d.close >= d.open ? 'candlestick-up' : 'candlestick-down')
        .attr('x', d => x(d.date))
        .attr('y', d => yPrice(Math.max(d.open, d.close)))
        .attr('width', x.bandwidth())
        .attr('height', d => Math.max(1, Math.abs(yPrice(d.open) - yPrice(d.close))));

      // Calculate and draw SMA lines
      const sma20 = [];
      const sma50 = [];
      data.forEach((d, i) => {
        if (i >= 19) {
          const sum = data.slice(i - 19, i + 1).reduce((acc, v) => acc + v.close, 0);
          sma20.push({ date: d.date, value: sum / 20 });
        }
        if (i >= 49) {
          const sum = data.slice(i - 49, i + 1).reduce((acc, v) => acc + v.close, 0);
          sma50.push({ date: d.date, value: sum / 50 });
        }
      });

      const line = d3.line()
        .x(d => x(d.date) + x.bandwidth() / 2)
        .y(d => yPrice(d.value));

      if (sma20.length > 0) {
        g.append('path')
          .datum(sma20)
          .attr('class', 'sma-line sma-20')
          .attr('d', line);
      }

      if (sma50.length > 0) {
        g.append('path')
          .datum(sma50)
          .attr('class', 'sma-line sma-50')
          .attr('d', line);
      }

      // Axes
      const xAxis = g.append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0,${chartHeight + gap + volumeHeight})`)
        .call(d3.axisBottom(x)
          .tickValues(x.domain().filter((d, i) => i % Math.ceil(data.length / 8) === 0))
        );

      g.append('g')
        .attr('class', 'axis')
        .call(d3.axisLeft(yPrice).ticks(6).tickFormat(d => '$' + d.toFixed(0)));

      // Tooltip interaction
      const tooltip = document.getElementById('chart-tooltip');

      svg.on('mousemove', function(event) {
        const [mx] = d3.pointer(event);
        const adjustedX = mx - margin.left;
        const index = Math.floor(adjustedX / (width / data.length));

        if (index >= 0 && index < data.length) {
          const d = data[index];
          tooltip.innerHTML = `
            <div class="tooltip-row"><span class="tooltip-label">Date:</span><span>${d.date}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Open:</span><span>$${d.open.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">High:</span><span>$${d.high.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Low:</span><span>$${d.low.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Close:</span><span>$${d.close.toFixed(2)}</span></div>
            <div class="tooltip-row"><span class="tooltip-label">Volume:</span><span>${(d.volume / 1000000).toFixed(1)}M</span></div>
          `;
          tooltip.classList.add('visible');
          tooltip.style.left = `${Math.min(event.offsetX + 10, container.clientWidth - 180)}px`;
          tooltip.style.top = `${event.offsetY - 80}px`;
        }
      });

      svg.on('mouseleave', function() {
        tooltip.classList.remove('visible');
      });
    }

    // MCP App event handlers
    app.ontoolresult = (result) => {
      console.log('Tool result received:', result);

      if (result.structuredContent) {
        portfolioData = result.structuredContent;
        renderDashboard(portfolioData);
      }
    };

    app.ontoolinput = (params) => {
      console.log('Tool input received:', params);
      document.getElementById('root').innerHTML = `
        <div class="loading">
          <div class="spinner"></div>
          <div>Analyzing portfolio...</div>
        </div>
      `;
    };

    app.onhostcontextchanged = (ctx) => {
      console.log('Host context changed:', ctx);
    };

    // Connect to host
    app.connect().then(() => {
      console.log('Connected to MCP host');
    }).catch(err => {
      console.error('Connection failed:', err);
      document.getElementById('root').innerHTML = `
        <div class="loading">
          <div style="color: #f4212e;">Connection failed: ${err.message}</div>
        </div>
      `;
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      if (portfolioData && selectedSymbol) {
        const stock = portfolioData.stocks[selectedSymbol];
        if (stock) {
          renderCandlestickChart(stock.data);
        }
      }
    });
  </script>
</body>
</html>"""


@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://esm.sh", "https://cdn.jsdelivr.net"]}}},
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
        print(f"ADK Financial Analytics Server listening on http://{HOST}:{PORT}/mcp")
        uvicorn.run(app, host=HOST, port=PORT)
