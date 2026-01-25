# @modelcontextprotocol/create-mcp-app

Scaffold new MCP App projects with one command.

## Usage

```bash
# Interactive mode
npm create @modelcontextprotocol/mcp-app

# With project name
npm create @modelcontextprotocol/mcp-app my-app

# With template
npm create @modelcontextprotocol/mcp-app my-app --template react

# Skip npm install
npm create @modelcontextprotocol/mcp-app my-app --no-install
```

## Templates

- **react** - React + Vite + TypeScript
- **vanillajs** - Vanilla JavaScript + Vite + TypeScript

## What's Included

Each generated project includes:

- MCP server with a sample `get-time` tool
- Interactive UI that communicates with the host
- Vite build configuration for bundling the UI
- TypeScript configuration
- Development server with hot reload

## Getting Started

After creating your project:

```bash
cd my-app
npm install  # if you used --no-install
npm run dev
```

Then test with the basic-host:

```bash
SERVERS='["http://localhost:3001/mcp"]' npx @modelcontextprotocol/basic-host
```

## License

MIT
