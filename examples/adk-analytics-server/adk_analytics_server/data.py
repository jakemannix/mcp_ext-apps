"""Stock data fetching from Tiingo API."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import requests

from .logging import get_logger, log_data_fetch

# Module logger
logger = get_logger("data")

# Tiingo API configuration
TIINGO_API_TOKEN = os.environ.get("TIINGO_API_TOKEN")
TIINGO_BASE_URL = "https://api.tiingo.com"

# Simple in-memory cache for stock data (cache_key -> (timestamp, data))
_stock_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


class TiingoConfigError(Exception):
    """Raised when Tiingo API is not configured."""

    pass


class TiingoAPIError(Exception):
    """Raised when Tiingo API request fails."""

    pass


def fetch_stock_data_from_tiingo(symbol: str, days: int = 60) -> list[dict]:
    """Fetch real stock data from Tiingo API.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL")
        days: Number of trading days of historical data to fetch

    Returns:
        List of OHLCV dictionaries with date, timestamp, open, high, low, close, volume

    Raises:
        TiingoConfigError: If TIINGO_API_TOKEN is not set
        TiingoAPIError: If API request fails
    """
    if not TIINGO_API_TOKEN:
        raise TiingoConfigError(
            "TIINGO_API_TOKEN environment variable not set. "
            "Get a free API key at https://www.tiingo.com/ and add it to your .env file."
        )

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

    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
    except requests.exceptions.Timeout:
        raise TiingoAPIError(f"Tiingo API timeout fetching {symbol} - try again later")
    except requests.exceptions.ConnectionError as e:
        raise TiingoAPIError(f"Tiingo API connection error: {e}")
    except requests.exceptions.RequestException as e:
        raise TiingoAPIError(f"Tiingo API request failed: {e}")

    # Handle HTTP errors with specific messages
    if response.status_code == 401:
        raise TiingoAPIError(
            "Tiingo API authentication failed - check your TIINGO_API_TOKEN is valid"
        )
    elif response.status_code == 404:
        raise TiingoAPIError(
            f"Symbol '{symbol}' not found on Tiingo - check the ticker symbol is correct"
        )
    elif response.status_code == 429:
        raise TiingoAPIError(
            "Tiingo API rate limit exceeded - wait a minute and try again"
        )
    elif not response.ok:
        raise TiingoAPIError(
            f"Tiingo API error {response.status_code}: {response.text[:200]}"
        )

    raw_data = response.json()

    if not raw_data:
        raise TiingoAPIError(
            f"No data returned for {symbol} - the symbol may be delisted or invalid"
        )

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
    """Get stock data with caching.

    Args:
        symbol: Stock ticker symbol (e.g., "AAPL")
        days: Number of trading days of historical data

    Returns:
        List of OHLCV dictionaries

    Raises:
        TiingoConfigError: If TIINGO_API_TOKEN is not set
        TiingoAPIError: If API request fails
    """
    cache_key = f"{symbol}:{days}"
    now = datetime.now().timestamp()

    # Check cache
    if cache_key in _stock_cache:
        cached_time, cached_data = _stock_cache[cache_key]
        if now - cached_time < _CACHE_TTL_SECONDS:
            logger.debug(f"Cache hit for {symbol} ({days} days)")
            return cached_data

    # Fetch from Tiingo (will raise on error)
    data = fetch_stock_data_from_tiingo(symbol, days)
    _stock_cache[cache_key] = (now, data)
    log_data_fetch(logger, symbol, "tiingo", days, success=True)

    return data
