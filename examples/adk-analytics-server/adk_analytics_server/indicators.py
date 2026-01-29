"""Technical indicators and AI-powered insights for stock analysis."""

from __future__ import annotations

import math


def calculate_technical_indicators(data: list[dict]) -> dict:
    """Calculate technical indicators for stock data.

    Args:
        data: List of OHLCV dictionaries with 'close' prices

    Returns:
        Dictionary containing:
        - sma20, sma50: Simple moving averages
        - rsi: Relative Strength Index
        - macd: MACD line, signal, histogram
        - bollingerBands: lower, middle, upper bands
        - currentPrice, priceChange, priceChangePercent
    """
    closes = [d["close"] for d in data]

    def sma(prices: list[float], period: int) -> float | None:
        """Calculate Simple Moving Average."""
        if len(prices) < period:
            return None
        return sum(prices[-period:]) / period

    def calculate_rsi(prices: list[float], period: int = 14) -> float | None:
        """Calculate Relative Strength Index."""
        if len(prices) < period + 1:
            return None
        gains = []
        losses = []
        for i in range(1, len(prices)):
            change = prices[i] - prices[i - 1]
            gains.append(max(0, change))
            losses.append(max(0, -change))
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 2)

    def calculate_macd(prices: list[float]) -> tuple[float | None, float | None, float | None]:
        """Calculate MACD (simplified version using SMA instead of EMA)."""
        if len(prices) < 26:
            return None, None, None
        ema12 = sum(prices[-12:]) / 12
        ema26 = sum(prices[-26:]) / 26
        macd_line = ema12 - ema26
        signal = macd_line * 0.9  # Simplified signal line
        histogram = macd_line - signal
        return round(macd_line, 4), round(signal, 4), round(histogram, 4)

    def bollinger_bands(prices: list[float], period: int = 20) -> tuple[float | None, float | None, float | None]:
        """Calculate Bollinger Bands."""
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
    """Generate AI-powered trading insights based on technical indicators.

    Args:
        symbol: Stock ticker symbol
        indicators: Technical indicators from calculate_technical_indicators()

    Returns:
        List of insight dictionaries with type, indicator, title, description, confidence
    """
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
