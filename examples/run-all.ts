#!/usr/bin/env bun
/**
 * Orchestration script for running all example servers.
 *
 * Usage:
 *   bun examples/run-all.ts start  - Build and start all examples
 *   bun examples/run-all.ts dev    - Run all examples in dev/watch mode
 *   bun examples/run-all.ts build  - Build all examples
 */

import { readdirSync, statSync, existsSync } from "fs";
import concurrently from "concurrently";

const BASE_PORT = 3101;
const BASIC_HOST = "basic-host";

// Find all example directories except basic-host that have a package.json,
// assign ports, and build URL list
const servers = readdirSync("examples")
  .filter(
    (d) =>
      d !== BASIC_HOST &&
      statSync(`examples/${d}`).isDirectory() &&
      existsSync(`examples/${d}/package.json`),
  )
  .sort() // Sort for consistent port assignment
  .map((dir, i) => ({
    dir,
    port: BASE_PORT + i,
    url: `http://localhost:${BASE_PORT + i}/mcp`,
  }));

const COMMANDS = ["start", "dev", "build"];

const command = process.argv[2];

if (!command || !COMMANDS.includes(command)) {
  console.error(`Usage: bun examples/run-all.ts <${COMMANDS.join("|")}>`);
  process.exit(1);
}

const AGGREGATOR = "aggregator-server";

// Separate aggregator from regular servers
const aggregator = servers.find((s) => s.dir === AGGREGATOR);
const regularServers = servers.filter((s) => s.dir !== AGGREGATOR);

// Build the SERVERS environment variable (JSON array of URLs) - all servers for basic-host
const serversEnv = JSON.stringify(servers.map((s) => s.url));
// Backend servers for aggregator - excludes itself
const backendServersEnv = JSON.stringify(regularServers.map((s) => s.url));

console.log(`Running command: ${command}`);
console.log(
  `Server examples: ${servers.map((s) => `${s.dir}:${s.port}`).join(", ")}`,
);
console.log("");

// Build command list for concurrently
const commands: Parameters<typeof concurrently>[0] = [
  // Regular server examples
  ...regularServers.map(({ dir, port }) => ({
    command: `npm run --workspace examples/${dir} ${command}`,
    name: dir,
    env: { PORT: String(port) },
  })),
  // Aggregator server with BACKEND_SERVERS env (excludes itself)
  ...(aggregator
    ? [
        {
          command: `npm run --workspace examples/${AGGREGATOR} ${command}`,
          name: AGGREGATOR,
          env: { PORT: String(aggregator.port), BACKEND_SERVERS: backendServersEnv },
        },
      ]
    : []),
  // Basic host with SERVERS env
  {
    command: `npm run --workspace examples/${BASIC_HOST} ${command}`,
    name: BASIC_HOST,
    env: { SERVERS: serversEnv },
  },
];

// If dev mode, also run the main library watcher
if (command === "dev") {
  commands.unshift({
    command: "npm run watch",
    name: "lib",
  });
}

const { result } = concurrently(commands, {
  prefix: "name",
  // For build command, we want all to complete; for start/dev, kill all on failure
  killOthersOnFail: command !== "build",
});

result.catch(() => process.exit(1));
