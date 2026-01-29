"""Entry point for the Descent agent server."""

import argparse
import logging

from .agent_server import run_server


def main():
    parser = argparse.ArgumentParser(description="Descent LLM Agent Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=3004, help="Port to listen on")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    log_level = "debug" if args.verbose else "info"
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    run_server(host=args.host, port=args.port, log_level=log_level)


if __name__ == "__main__":
    main()
