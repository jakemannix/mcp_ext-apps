"""Entry point for running as `python -m adk_analytics_server`.

Commands:
  python -m adk_analytics_server          # Start MCP server (port 3003)
  python -m adk_analytics_server agent    # Start agent server (port 3004)
"""

import argparse
import sys


def main() -> None:
    """Parse command and dispatch to appropriate server."""
    parser = argparse.ArgumentParser(
        description="ADK Financial Analytics",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  (default)  Start the MCP server on port 3003
  agent      Start the LLM agent server on port 3004

Examples:
  # Start MCP server (required for agent to work)
  uv run python -m adk_analytics_server

  # Start agent server (in another terminal)
  uv run python -m adk_analytics_server agent

  # With verbose logging
  uv run python -m adk_analytics_server -v
  uv run python -m adk_analytics_server agent -v
        """,
    )

    parser.add_argument(
        "command",
        nargs="?",
        choices=["agent"],
        default=None,
        help="Command to run (default: start MCP server)",
    )

    # Common options that apply to both servers
    parser.add_argument(
        "-v", "--verbose",
        action="count",
        default=0,
        help="Increase verbosity (-v for DEBUG, -vv for TRACE)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="Port to bind to (default: 3003 for MCP, 3004 for agent)",
    )

    # MCP server options
    parser.add_argument(
        "--stdio",
        action="store_true",
        help="Run MCP server in STDIO mode (for Claude Desktop)",
    )
    parser.add_argument(
        "--log-file",
        help="Write structured JSON logs to file",
    )

    args = parser.parse_args()

    if args.command == "agent":
        run_agent_server(args)
    else:
        run_mcp_server(args)


def run_mcp_server(args: argparse.Namespace) -> None:
    """Run the MCP server."""
    from pathlib import Path

    from .logging import setup_logging
    from .server import mcp, logger

    # Set up logging
    setup_logging(
        verbosity=args.verbose,
        log_file=Path(args.log_file) if args.log_file else None,
    )

    port = args.port or 3003

    logger.info("Starting ADK Financial Analytics MCP Server")
    if args.verbose >= 2:
        logger.debug("Very verbose logging enabled (TRACE level)")
    elif args.verbose == 1:
        logger.debug("Verbose logging enabled (DEBUG level)")

    if args.stdio:
        logger.info("Running in STDIO mode")
        mcp.run(transport="stdio")
    else:
        import uvicorn
        from starlette.middleware.cors import CORSMiddleware

        app = mcp.streamable_http_app()
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        logger.info(f"Listening on http://{args.host}:{port}/mcp")
        uvicorn.run(app, host=args.host, port=port)


def run_agent_server(args: argparse.Namespace) -> None:
    """Run the agent server."""
    from .logging import setup_logging

    # Set up logging
    setup_logging(verbosity=args.verbose)

    port = args.port or 3004
    log_level = "debug" if args.verbose else "info"

    from .agent_server import run_server
    run_server(host=args.host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
