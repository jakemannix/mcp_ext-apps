#!/usr/bin/env bun
/**
 * Migrates basic-server-* examples to the new structure:
 * - server.ts: Only exports createServer()
 * - main.ts: Entry point with main() that runs the server
 * - package.json: Updated with bin field and bun build commands
 */

import { $ } from "bun";
import fs from "node:fs/promises";
import path from "node:path";

const EXAMPLES_DIR = path.join(import.meta.dirname, "..", "examples");

interface ExampleConfig {
  dir: string;
  serverName: string;
  binName: string;
  port: string;
}

async function getExamples(): Promise<ExampleConfig[]> {
  const dirs = await fs.readdir(EXAMPLES_DIR);
  const examples: ExampleConfig[] = [];

  for (const dir of dirs) {
    if (!dir.startsWith("basic-server-")) continue;
    if (dir === "basic-server-react") continue; // Already migrated

    const serverTs = await fs.readFile(path.join(EXAMPLES_DIR, dir, "server.ts"), "utf-8");

    // Extract server name from: name: "Basic MCP App Server (React)"
    const nameMatch = serverTs.match(/name:\s*["']([^"']+)["']/);
    const serverName = nameMatch?.[1] ?? `Basic MCP App Server (${dir.replace("basic-server-", "")})`;

    // Extract port from: PORT ?? "3001"
    const portMatch = serverTs.match(/PORT\s*\?\?\s*["'](\d+)["']/);
    const port = portMatch?.[1] ?? "3001";

    // Create bin name: mcp-server-basic-react
    const binName = `mcp-server-${dir.replace("basic-server-", "basic-")}`;

    examples.push({ dir, serverName, binName, port });
  }

  return examples;
}

async function migrateExample(config: ExampleConfig) {
  const { dir, serverName, binName, port } = config;
  const exampleDir = path.join(EXAMPLES_DIR, dir);
  console.log(`\n=== Migrating ${dir} ===`);
  console.log(`  Server name: ${serverName}`);
  console.log(`  Bin name: ${binName}`);
  console.log(`  Port: ${port}`);

  // 1. Read and modify server.ts
  const serverTs = await fs.readFile(path.join(exampleDir, "server.ts"), "utf-8");

  // Remove main function and related imports, ensure createServer is exported
  let newServerTs = serverTs
    // Remove StdioServerTransport import
    .replace(/import\s*\{\s*StdioServerTransport\s*\}\s*from\s*["']@modelcontextprotocol\/sdk\/server\/stdio\.js["'];\s*\n?/g, "")
    // Remove startServer import
    .replace(/import\s*\{\s*startServer\s*\}\s*from\s*["']\.\/server-utils\.js["'];\s*\n?/g, "")
    // Remove main function and call
    .replace(/\nasync function main\(\)[\s\S]*?main\(\)\.catch[\s\S]*?\}\);?\s*$/m, "\n")
    // Ensure createServer is exported
    .replace(/^function createServer\(\)/m, "export function createServer()");

  await fs.writeFile(path.join(exampleDir, "server.ts"), newServerTs.trim() + "\n");
  console.log("  ✓ Updated server.ts");

  // 2. Read server-utils.ts
  const serverUtils = await fs.readFile(path.join(exampleDir, "server-utils.ts"), "utf-8");

  // Create main.ts with added imports and main function
  const mainTs = serverUtils
    .replace(
      /\/\*\*\s*\n\s*\*\s*Shared utilities/,
      `/**\n * Entry point for running the MCP server.\n * Run with: npx ${binName}\n * Or: node dist/index.js [--stdio]\n */\n\n/**\n * Shared utilities`
    )
    .replace(
      /import\s*\{\s*createMcpExpressApp\s*\}/,
      `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";\nimport { createMcpExpressApp }`
    )
    .replace(
      /import type \{ Request, Response \} from "express";/,
      `import type { Request, Response } from "express";\nimport { createServer } from "./server.js";`
    )
    .trim() + `

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "${port}", 10);
    await startServer(createServer, { port, name: "${serverName}" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;

  await fs.writeFile(path.join(exampleDir, "main.ts"), mainTs);
  console.log("  ✓ Created main.ts");

  // 3. Remove old server-utils.ts and stage the rename
  await fs.unlink(path.join(exampleDir, "server-utils.ts"));
  await $`cd ${exampleDir} && git add -A server-utils.ts main.ts`.quiet();
  console.log("  ✓ Renamed server-utils.ts -> main.ts");

  // 4. Update tsconfig.server.json
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      declaration: true,
      emitDeclarationOnly: true,
      outDir: "./dist",
      rootDir: ".",
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    include: ["server.ts"],
  };
  await fs.writeFile(path.join(exampleDir, "tsconfig.server.json"), JSON.stringify(tsconfig, null, 2) + "\n");
  console.log("  ✓ Updated tsconfig.server.json");

  // 5. Update package.json
  const pkgPath = path.join(exampleDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

  pkg.main = "dist/server.js";
  pkg.types = "dist/server.d.ts";
  pkg.bin = { [binName]: "dist/index.js" };
  pkg.exports = {
    ".": {
      types: "./dist/server.d.ts",
      default: "./dist/server.js",
    },
  };
  pkg.scripts.build = "tsc --noEmit && cross-env INPUT=mcp-app.html vite build && tsc -p tsconfig.server.json && bun build server.ts --outdir dist --target node && bun build main.ts --outfile dist/index.js --target node --banner '#!/usr/bin/env node' && chmod +x dist/index.js";
  pkg.scripts.serve = "bun --watch main.ts";
  delete pkg.scripts["build:server"];

  // Move cors and express to dependencies
  if (pkg.devDependencies?.cors) {
    pkg.dependencies.cors = pkg.devDependencies.cors;
    delete pkg.devDependencies.cors;
  }
  if (pkg.devDependencies?.express) {
    pkg.dependencies.express = pkg.devDependencies.express;
    delete pkg.devDependencies.express;
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log("  ✓ Updated package.json");
}

async function main() {
  const examples = await getExamples();
  console.log(`Found ${examples.length} examples to migrate:`);
  for (const ex of examples) {
    console.log(`  - ${ex.dir}`);
  }

  for (const example of examples) {
    await migrateExample(example);
  }

  console.log("\n✅ Migration complete!");
  console.log("\nNext steps:");
  console.log("1. Run: npm run build:all");
  console.log("2. Run: npm run test:e2e");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
