"""Structured logging configuration for ADK Analytics Server."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Custom TRACE level for very verbose logging (below DEBUG)
TRACE_LEVEL = 5
logging.addLevelName(TRACE_LEVEL, "TRACE")


class StructuredFormatter(logging.Formatter):
    """JSON formatter for structured log output."""

    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Add extra fields if present
        if hasattr(record, "tool_name"):
            log_data["tool_name"] = record.tool_name
        if hasattr(record, "tool_args"):
            log_data["tool_args"] = record.tool_args
        if hasattr(record, "tool_result"):
            log_data["tool_result"] = record.tool_result
        if hasattr(record, "duration_ms"):
            log_data["duration_ms"] = record.duration_ms
        if hasattr(record, "symbol"):
            log_data["symbol"] = record.symbol
        if hasattr(record, "data_source"):
            log_data["data_source"] = record.data_source
        if hasattr(record, "structured_content"):
            log_data["structured_content"] = record.structured_content

        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_data)


class ConsoleFormatter(logging.Formatter):
    """Human-readable formatter for console output."""

    COLORS = {
        "TRACE": "\033[35m",    # Magenta
        "DEBUG": "\033[36m",    # Cyan
        "INFO": "\033[32m",     # Green
        "WARNING": "\033[33m",  # Yellow
        "ERROR": "\033[31m",    # Red
        "RESET": "\033[0m",
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        reset = self.COLORS["RESET"]

        # Basic message
        msg = f"{color}[{record.levelname}]{reset} {record.getMessage()}"

        # Add extra context for verbose logging
        extras = []
        if hasattr(record, "tool_name"):
            extras.append(f"tool={record.tool_name}")
        if hasattr(record, "duration_ms"):
            extras.append(f"duration={record.duration_ms}ms")
        if hasattr(record, "symbol"):
            extras.append(f"symbol={record.symbol}")
        if hasattr(record, "data_source"):
            extras.append(f"source={record.data_source}")

        if extras:
            msg += f" ({', '.join(extras)})"

        return msg


def setup_logging(
    verbosity: int = 0,
    log_file: Path | str | None = None,
    log_level: str = "INFO",
) -> logging.Logger:
    """Configure logging for the server.

    Args:
        verbosity: Verbosity level (0=normal, 1=verbose/DEBUG, 2+=very verbose/TRACE)
        log_file: Path to structured JSON log file (None for no file logging)
        log_level: Base log level (DEBUG, INFO, WARNING, ERROR)

    Returns:
        Configured root logger for the package
    """
    # Determine effective log level based on verbosity
    if verbosity >= 2:
        level = TRACE_LEVEL  # -vv: TRACE level, includes structuredContent
    elif verbosity == 1:
        level = logging.DEBUG  # -v: DEBUG level
    else:
        level = getattr(logging, log_level.upper(), logging.INFO)

    # Get package logger
    logger = logging.getLogger("adk_analytics_server")
    logger.setLevel(level)
    logger.propagate = False  # Prevent duplicate output to root logger

    # Remove existing handlers
    logger.handlers.clear()

    # Console handler with human-readable format
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(level)
    console_handler.setFormatter(ConsoleFormatter())
    logger.addHandler(console_handler)

    # File handler with structured JSON format
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        file_handler = logging.FileHandler(log_path, mode="a", encoding="utf-8")
        file_handler.setLevel(TRACE_LEVEL)  # Log everything including TRACE to file
        file_handler.setFormatter(StructuredFormatter())
        logger.addHandler(file_handler)

        logger.info(f"Logging to file: {log_path}")

    return logger


def get_logger(name: str = "adk_analytics_server") -> logging.Logger:
    """Get a logger instance for the package.

    Args:
        name: Logger name (will be prefixed with package name if not already)

    Returns:
        Logger instance
    """
    if not name.startswith("adk_analytics_server"):
        name = f"adk_analytics_server.{name}"
    return logging.getLogger(name)


def log_tool_call(
    logger: logging.Logger,
    tool_name: str,
    args: dict[str, Any],
) -> None:
    """Log an MCP tool call."""
    logger.debug(
        f"Tool call: {tool_name}",
        extra={"tool_name": tool_name, "tool_args": args},
    )


def log_tool_result(
    logger: logging.Logger,
    tool_name: str,
    result_summary: str,
    duration_ms: float,
    structured_content: dict | None = None,
) -> None:
    """Log an MCP tool result.

    Args:
        logger: Logger instance
        tool_name: Name of the tool
        result_summary: Brief summary of the result
        duration_ms: Execution time in milliseconds
        structured_content: Full structured content (logged at TRACE level / -vv)
    """
    extra: dict = {
        "tool_name": tool_name,
        "tool_result": result_summary,
        "duration_ms": round(duration_ms, 2),
    }

    # Log summary at DEBUG level
    logger.debug(
        f"Tool result: {tool_name} -> {result_summary}",
        extra=extra,
    )

    # Log full structured content at TRACE level (level 5, below DEBUG)
    if structured_content is not None and logger.isEnabledFor(TRACE_LEVEL):
        import json
        extra["structured_content"] = structured_content
        logger.log(
            TRACE_LEVEL,
            f"Tool structuredContent: {json.dumps(structured_content, default=str)}",
            extra=extra,
        )


def log_data_fetch(
    logger: logging.Logger,
    symbol: str,
    source: str,
    days: int,
    success: bool,
) -> None:
    """Log a data fetch operation."""
    status = "success" if success else "failed"
    logger.debug(
        f"Data fetch {status}: {symbol} ({days} days from {source})",
        extra={"symbol": symbol, "data_source": source},
    )
