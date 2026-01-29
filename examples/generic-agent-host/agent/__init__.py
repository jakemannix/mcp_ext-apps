"""Generic LLM agent host with MCP Apps bridge support."""

__version__ = "0.1.0"

# Load .env from repository root
from pathlib import Path
from dotenv import load_dotenv

_repo_root = Path(__file__).parent.parent.parent.parent
_env_file = _repo_root / ".env"
if _env_file.exists():
    load_dotenv(_env_file)
