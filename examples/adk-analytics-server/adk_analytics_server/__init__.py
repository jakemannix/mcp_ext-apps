"""ADK Financial Analytics Server - MCP Apps demo with Tiingo market data."""

from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (three levels up: package -> example -> examples -> repo root)
_env_path = Path(__file__).parent.parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

__version__ = "1.0.0"
