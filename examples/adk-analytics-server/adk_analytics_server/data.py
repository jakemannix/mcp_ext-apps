"""Stock data fetching from Tiingo API with fallback to mock data."""

from __future__ import annotations

import os
import random
from datetime import datetime, timedelta

import requests

# Tiingo API configuration
TIINGO_API_TOKEN = os.environ.get("TIINGO_API_TOKEN")
TIINGO_BASE_URL = "https://api.tiingo.com"

# Simple in-memory cache for stock data (cache_key -> (timestamp, data))
_stock_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


def fetch_stock_data_from_tiingo(symbol: str, days: int = 60) -> list[dict]:
    """Fetch real stock data from Tiingo API.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL")
        days: Number of trading days of historical data to fetch

    Returns:
        List of OHLCV dictionaries with date, timestamp, open, high, low, close, volume

    Raises:
        ValueError: If TIINGO_API_TOKEN is not set
        requests.HTTPError: If API request fails
    """
    if not TIINGO_API_TOKEN:
        raise ValueError("TIINGO_API_TOKEN environment variable not set")

    # Calculate date range - request extra days to account for weekends/holidays
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days + 30)

    url = f"{TIINGO_BASE_URL}/tiingo/daily/{symbol}/prices"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Token {TIINGO_API_TOKEN}",
    }
    params = {
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d"),
    }

    response = requests.get(url, headers=headers, params=params, timeout=10)
    response.raise_for_status()

    raw_data = response.json()

    # Transform to our format and take only the last N trading days
    data = []
    for row in raw_data[-days:]:
        date_str = row["date"][:10]  # "2024-01-15T00:00:00+00:00" -> "2024-01-15"
        data.append({
            "date": date_str,
            "timestamp": int(datetime.fromisoformat(row["date"].replace("Z", "+00:00")).timestamp() * 1000),
            "open": round(row["adjOpen"], 2),
            "high": round(row["adjHigh"], 2),
            "low": round(row["adjLow"], 2),
            "close": round(row["adjClose"], 2),
            "volume": int(row["adjVolume"]),
        })

    return data


def get_stock_data(symbol: str, days: int = 60) -> list[dict]:
    """Get stock data with caching. Falls back to mock data if Tiingo unavailable.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL")
        days: Number of trading days of historical data

    Returns:
        List of OHLCV dictionaries
    """
    cache_key = f"{symbol}:{days}"
    now = datetime.now().timestamp()

    # Check cache
    if cache_key in _stock_cache:
        cached_time, cached_data = _stock_cache[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return cached_data

    # Try Tiingo API
    if TIINGO_API_TOKEN:
        try:
            data = fetch_stock_data_from_tiingo(symbol, days)
            _stock_cache[cache_key] = (now, data)
            return data
        except Exception as e:
            print(f"Tiingo API error for {symbol}: {e}, falling back to mock data")

    # Fallback to mock data
    data = generate_mock_stock_data(symbol, days)
    return data


def generate_mock_stock_data(symbol: str, days: int = 60) -> list[dict]:
    """Generate mock stock price data (fallback when Tiingo unavailable).

    Args:
        symbol: Stock ticker symbol
        days: Number of days of data to generate

    Returns:
        List of OHLCV dictionaries with simulated price data
    """
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
