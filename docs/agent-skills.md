---
title: Agent Skills
---

# Install the Skills

The MCP Apps repository provides two [Agent Skills](https://agentskills.io/) for AI coding agents: one for scaffolding MCP Apps with interactive UIs, and one for migrating from the OpenAI Apps SDK.

Choose one of the following installation methods based on your agent:

## Option 1: Claude Code Plugin

Install via Claude Code:

```
/plugin marketplace add modelcontextprotocol/ext-apps
/plugin install mcp-apps@modelcontextprotocol-ext-apps
```

## Option 2: Vercel Skills CLI

Use the [Vercel Skills CLI](https://skills.sh/) to install skills across different AI coding agents:

```bash
npx skills add modelcontextprotocol/ext-apps
```

## Option 3: Manual Installation

Clone the repository:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
```

Then copy the skills from `plugins/mcp-apps/skills/` to your agent's skills directory. See your agent's documentation for the correct location:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/skills)
- [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) / [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Gemini CLI](https://geminicli.com/docs/cli/skills/)
- [Cline](https://docs.cline.bot/features/skills#skills)
- [Goose](https://block.github.io/goose/docs/guides/context-engineering/using-skills/)

## Verify Installation

Ask your agent "What skills do you have?" — you should see `create-mcp-app` and `migrate-oai-app` among the available skills.

## Next Steps

Try invoking the skills by asking your agent:

- "Create an MCP App" — scaffolds a new MCP App with an interactive UI
- "Migrate from OpenAI Apps SDK" — converts an existing OpenAI App to use the MCP Apps SDK
