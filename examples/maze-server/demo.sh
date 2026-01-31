#!/bin/bash
#
# Demo script for the SimpleMaze MCP Apps demo
#
# Usage:
#   ./demo.sh [start|stop|tunnel]
#
#   start           - Start all services (stops existing ones first)
#   stop            - Stop all running services
#   tunnel          - Start MCP server + Cloudflare tunnel (for use with Claude.ai)
#
# Services:
#   - MCP Server:   port 3002
#   - Agent Server: port 3004 (start only)
#   - Frontend:     port 5173 (start only)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENT_HOST_DIR="$SCRIPT_DIR/../generic-agent-host"

# Log files (overwritten each run)
LOG_DIR="$SCRIPT_DIR/logs"
MCP_LOG="$LOG_DIR/mcp-server.log"
AGENT_LOG="$LOG_DIR/agent-server.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Cleanup function to kill background processes on exit
cleanup() {
    log_info "Shutting down services..."
    if [ -n "$MCP_SERVER_PID" ]; then
        kill $MCP_SERVER_PID 2>/dev/null || true
    fi
    if [ -n "$AGENT_SERVER_PID" ]; then
        kill $AGENT_SERVER_PID 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    if [ -n "$TUNNEL_PID" ]; then
        kill $TUNNEL_PID 2>/dev/null || true
    fi
    log_info "All services stopped."
    exit 0
}

trap cleanup SIGINT SIGTERM

# ============================================================================
# Stop any existing services on our ports (for idempotency)
# ============================================================================

# Get PID of process listening on a port (macOS/Linux compatible)
get_pid_on_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        lsof -ti tcp:$port 2>/dev/null | head -1
    elif command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$port " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1
    elif command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1 | head -1
    fi
}

# Gracefully stop a process, with escalation to SIGKILL if needed
stop_process_on_port() {
    local port=$1
    local service_name=$2
    local pid=$(get_pid_on_port $port)

    if [ -n "$pid" ]; then
        log_warn "Found existing process on port $port (PID: $pid) - stopping it..."

        # First try SIGTERM for graceful shutdown
        kill $pid 2>/dev/null || true

        # Wait up to 5 seconds for graceful shutdown
        local retries=0
        while [ $retries -lt 10 ]; do
            if ! kill -0 $pid 2>/dev/null; then
                log_success "Stopped existing $service_name (was PID: $pid)"
                return 0
            fi
            sleep 0.5
            retries=$((retries + 1))
        done

        # If still running, escalate to SIGKILL
        if kill -0 $pid 2>/dev/null; then
            log_warn "Process $pid not responding to SIGTERM, sending SIGKILL..."
            kill -9 $pid 2>/dev/null || true
            sleep 0.5
        fi

        if ! kill -0 $pid 2>/dev/null; then
            log_success "Stopped existing $service_name (was PID: $pid)"
        else
            log_error "Failed to stop process on port $port"
            return 1
        fi
    fi
    return 0
}

stop_existing_services() {
    log_info "Checking for existing services on ports 3002, 3004, 5173..."

    local found_any=false

    if [ -n "$(get_pid_on_port 3002)" ]; then found_any=true; fi
    if [ -n "$(get_pid_on_port 3004)" ]; then found_any=true; fi
    if [ -n "$(get_pid_on_port 5173)" ]; then found_any=true; fi

    if [ "$found_any" = false ]; then
        log_info "No existing services found"
        return 0
    fi

    stop_process_on_port 3002 "MCP server"
    stop_process_on_port 3004 "Agent server"
    stop_process_on_port 5173 "Frontend dev server"
}

# ============================================================================
# Check for .env file and load it
# ============================================================================

check_env() {
    local env_file=""

    # Look for .env in various locations
    if [ -f "$SCRIPT_DIR/.env" ]; then
        env_file="$SCRIPT_DIR/.env"
    elif [ -f "$AGENT_HOST_DIR/.env" ]; then
        env_file="$AGENT_HOST_DIR/.env"
    elif [ -f "$REPO_ROOT/.env" ]; then
        env_file="$REPO_ROOT/.env"
    fi

    if [ -n "$env_file" ]; then
        log_info "Loading environment from $env_file"
        set -a
        source "$env_file"
        set +a
    fi

    # Check for at least one LLM API key
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
        log_error "No LLM API key found!"
        echo ""
        echo "Please set one of the following environment variables:"
        echo "  - ANTHROPIC_API_KEY (recommended, uses Claude)"
        echo "  - OPENROUTER_API_KEY (with optional MODEL_NAME)"
        echo "  - GOOGLE_API_KEY (uses Gemini)"
        echo ""
        echo "You can either:"
        echo "  1. Export the variable: export ANTHROPIC_API_KEY='your-key'"
        echo "  2. Create a .env file in one of these locations:"
        echo "     - $SCRIPT_DIR/.env"
        echo "     - $AGENT_HOST_DIR/.env"
        echo "     - $REPO_ROOT/.env"
        echo ""
        echo "Example .env file:"
        echo "  ANTHROPIC_API_KEY=sk-ant-..."
        exit 1
    fi

    # Report which provider will be used
    if [ -n "$ANTHROPIC_API_KEY" ]; then
        log_success "Found ANTHROPIC_API_KEY - will use Claude"
    elif [ -n "$OPENROUTER_API_KEY" ]; then
        log_success "Found OPENROUTER_API_KEY - will use OpenRouter"
        if [ -n "$MODEL_NAME" ]; then
            log_info "  Model: $MODEL_NAME"
        fi
    elif [ -n "$GOOGLE_API_KEY" ]; then
        log_success "Found GOOGLE_API_KEY - will use Gemini"
    fi
}

# ============================================================================
# Check dependencies
# ============================================================================

check_dependencies() {
    local skip_agent_host="${1:-false}"

    log_info "Checking dependencies..."

    # Check for node
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 18+."
        exit 1
    fi
    log_success "Node.js $(node --version) found"

    # Check for npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed."
        exit 1
    fi
    log_success "npm $(npm --version) found"

    # Only check uv and agent-host if we need them
    if [ "$skip_agent_host" = false ]; then
        # Check for uv (Python package manager)
        if ! command -v uv &> /dev/null; then
            log_error "uv is not installed. Please install uv: https://docs.astral.sh/uv/getting-started/installation/"
            exit 1
        fi
        log_success "uv found"
    fi

    # Check if maze-server is built
    if [ ! -f "$SCRIPT_DIR/dist/main.js" ]; then
        log_warn "Maze server not built. Building now..."
        build_maze_server
    else
        log_success "Maze server already built"
    fi

    # Check if agent-host frontend is built (only for start command)
    if [ "$skip_agent_host" = false ]; then
        if [ ! -f "$AGENT_HOST_DIR/agent/static/index.html" ]; then
            log_warn "Agent host frontend not built. Building now..."
            build_agent_host
        else
            log_success "Agent host frontend already built"
        fi
    fi
}

check_cloudflared() {
    if ! command -v cloudflared &> /dev/null; then
        log_error "cloudflared is not installed."
        echo ""
        echo "Install with:"
        echo "  macOS:  brew install cloudflared"
        echo "  Linux:  See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        exit 1
    fi
    log_success "cloudflared found"
}

# ============================================================================
# Build functions
# ============================================================================

build_maze_server() {
    log_info "Building maze-server..."
    cd "$SCRIPT_DIR"
    npm install
    npm run build
    log_success "Maze server built successfully"
}

build_agent_host() {
    log_info "Building agent host frontend..."
    cd "$AGENT_HOST_DIR"
    npm install
    npm run build
    log_success "Agent host frontend built successfully"
}

# ============================================================================
# Service launchers
# ============================================================================

setup_logs() {
    mkdir -p "$LOG_DIR"
    # Truncate log files
    > "$MCP_LOG"
    > "$AGENT_LOG"
    > "$TUNNEL_LOG"
    log_info "Logs will be written to: $LOG_DIR/"
}

start_mcp_server() {
    local verbose="${1:-false}"
    log_info "Starting MCP server on port 3002..."
    cd "$SCRIPT_DIR"

    if [ "$verbose" = true ]; then
        VERBOSE=true node dist/main.js 2>&1 | tee "$MCP_LOG" &
    else
        node dist/main.js 2>&1 | tee "$MCP_LOG" &
    fi
    MCP_SERVER_PID=$!

    # Wait for server to be ready
    local retries=0
    while ! curl -s http://localhost:3002/mcp > /dev/null 2>&1; do
        sleep 0.5
        retries=$((retries + 1))
        if [ $retries -gt 20 ]; then
            log_error "MCP server failed to start"
            exit 1
        fi
    done
    log_success "MCP server running (PID: $MCP_SERVER_PID)"
    log_info "MCP server log: $MCP_LOG"
}

start_agent_server() {
    log_info "Starting agent server on port 3004..."
    cd "$AGENT_HOST_DIR"
    MCP_SERVER_URL=http://localhost:3002 uv run python -m agent --port 3004 2>&1 | tee "$AGENT_LOG" &
    AGENT_SERVER_PID=$!

    # Wait for server to be ready
    local retries=0
    while ! curl -s http://localhost:3004/health > /dev/null 2>&1; do
        sleep 0.5
        retries=$((retries + 1))
        if [ $retries -gt 30 ]; then
            log_error "Agent server failed to start"
            exit 1
        fi
    done
    log_success "Agent server running (PID: $AGENT_SERVER_PID)"
    log_info "Agent server log: $AGENT_LOG"
}

start_frontend_dev() {
    log_info "Starting frontend dev server on port 5173..."
    cd "$AGENT_HOST_DIR"
    npm run dev &
    FRONTEND_PID=$!

    # Wait for server to be ready
    local retries=0
    while ! curl -s http://localhost:5173 > /dev/null 2>&1; do
        sleep 0.5
        retries=$((retries + 1))
        if [ $retries -gt 30 ]; then
            log_error "Frontend dev server failed to start"
            exit 1
        fi
    done
    log_success "Frontend dev server running (PID: $FRONTEND_PID)"
}

start_cloudflare_tunnel() {
    log_info "Starting Cloudflare tunnel to localhost:3002..."

    # Start cloudflared in quick tunnel mode (no account needed)
    cloudflared tunnel --url http://localhost:3002 2>&1 | tee "$TUNNEL_LOG" &
    TUNNEL_PID=$!

    # Use log file to capture tunnel URL
    local tunnel_output="$TUNNEL_LOG"

    # Wait for the tunnel URL to appear in the output
    log_info "Waiting for tunnel URL..."
    local retries=0
    local tunnel_url=""
    while [ -z "$tunnel_url" ] && [ $retries -lt 30 ]; do
        sleep 1
        tunnel_url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$tunnel_output" 2>/dev/null | head -1)
        retries=$((retries + 1))
    done

    if [ -z "$tunnel_url" ]; then
        log_error "Failed to get tunnel URL"
        exit 1
    fi

    TUNNEL_URL="$tunnel_url"
    log_success "Cloudflare tunnel running (PID: $TUNNEL_PID)"
    log_success "Public URL: $TUNNEL_URL"
}

# ============================================================================
# Commands
# ============================================================================

cmd_start() {
    local verbose="${1:-false}"

    echo ""
    echo "=========================================="
    echo "   SimpleMaze MCP Apps Demo"
    echo "=========================================="
    echo ""

    check_env
    echo ""
    check_dependencies
    echo ""

    stop_existing_services
    echo ""

    setup_logs
    log_info "Starting all services..."
    echo ""

    start_mcp_server "$verbose"
    start_agent_server
    start_frontend_dev

    echo ""
    echo "=========================================="
    echo -e "${GREEN}All services are running!${NC}"
    echo "=========================================="
    echo ""
    echo "  Game URL:     http://localhost:5173"
    echo ""
    echo "  Services:"
    echo "    - MCP Server:   http://localhost:3002/mcp"
    echo "    - Agent Server: http://localhost:3004"
    echo "    - Frontend:     http://localhost:5173"
    echo ""
    echo "  To start playing:"
    echo "    1. Open http://localhost:5173 in your browser"
    echo "    2. Type: \"Start a maze game\" in the chat"
    echo "    3. Use arrow keys to move, explore the dungeon!"
    echo ""
    echo "  Press Ctrl+C to stop all services"
    echo ""

    # Wait for any background process to exit
    wait
}

cmd_stop() {
    echo ""
    echo "=========================================="
    echo "   SimpleMaze MCP Apps Demo - Stop"
    echo "=========================================="
    echo ""

    stop_existing_services

    echo ""
    log_success "Done"
}

cmd_tunnel() {
    local verbose="${1:-false}"

    echo ""
    echo "=========================================="
    echo "   SimpleMaze MCP Apps - Tunnel Mode"
    echo "=========================================="
    echo ""

    check_cloudflared
    check_dependencies true  # skip agent-host checks
    echo ""

    # Only stop the MCP server port for tunnel mode
    log_info "Checking for existing MCP server on port 3002..."
    if [ -n "$(get_pid_on_port 3002)" ]; then
        stop_process_on_port 3002 "MCP server"
    else
        log_info "No existing MCP server found"
    fi
    echo ""

    setup_logs
    log_info "Starting services for tunnel mode..."
    echo ""

    start_mcp_server "$verbose"
    start_cloudflare_tunnel

    echo ""
    echo "=========================================="
    echo -e "${GREEN}Tunnel mode is running!${NC}"
    echo "=========================================="
    echo ""
    echo "  Your MCP server is now publicly accessible at:"
    echo ""
    echo -e "    ${GREEN}${TUNNEL_URL}/mcp${NC}"
    echo ""
    echo "  To use with Claude.ai:"
    echo ""
    echo "    1. Go to Claude.ai Settings > MCP Servers"
    echo "    2. Add a new server with this configuration:"
    echo ""
    echo "       {"
    echo "         \"maze\": {"
    echo "           \"url\": \"${TUNNEL_URL}/mcp\""
    echo "         }"
    echo "       }"
    echo ""
    echo "    3. Start a new conversation and say:"
    echo "       \"Start a maze game on easy difficulty\""
    echo ""
    echo "  Press Ctrl+C to stop the tunnel and server"
    echo ""

    # Wait for background processes
    wait
}

usage() {
    echo ""
    echo "SimpleMaze MCP Apps Demo"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start   Start all demo services - local agent host mode"
    echo "  stop    Stop all running demo services"
    echo "  tunnel  Start MCP server with Cloudflare tunnel for Claude.ai"
    echo "  logs    Tail the MCP server log file"
    echo "  help    Show this help message"
    echo ""
    echo "Options:"
    echo "  --verbose, -v   Enable verbose request/response logging"
    echo ""
    echo "Log files are written to: $LOG_DIR/"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

cmd_logs() {
    if [ ! -f "$MCP_LOG" ]; then
        log_error "No log file found. Start the server first."
        exit 1
    fi
    echo "Tailing $MCP_LOG (Ctrl+C to stop)..."
    echo ""
    tail -f "$MCP_LOG"
}

main() {
    local command="${1:-}"
    local verbose=false

    # Parse flags
    for arg in "$@"; do
        case "$arg" in
            --verbose|-v)
                verbose=true
                ;;
        esac
    done

    # Show help if no command given
    if [ -z "$command" ]; then
        usage
        exit 0
    fi

    case "$command" in
        start)
            cmd_start "$verbose"
            ;;
        stop)
            cmd_stop
            ;;
        tunnel)
            cmd_tunnel "$verbose"
            ;;
        logs)
            cmd_logs
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

main "$@"
