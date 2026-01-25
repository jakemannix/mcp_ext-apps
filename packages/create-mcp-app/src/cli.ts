import * as p from "@clack/prompts";
import pc from "picocolors";
import { scaffold } from "./scaffold.js";
import {
  SDK_VERSION,
  TEMPLATES,
  type TemplateName,
  validateProjectName,
} from "./utils.js";

interface CliArgs {
  projectName?: string;
  template?: string;
  noInstall?: boolean;
  help?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--no-install") {
      result.noInstall = true;
    } else if (arg === "--template" || arg === "-t") {
      result.template = args[++i];
    } else if (!arg.startsWith("-") && !result.projectName) {
      result.projectName = arg;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
${pc.bold("create-mcp-app")} - Scaffold MCP App projects

${pc.bold("Usage:")}
  npm create @modelcontextprotocol/mcp-app [project-name] [options]

${pc.bold("Options:")}
  -t, --template <name>  Template to use (${TEMPLATES.map((t) => t.value).join(", ")})
  --no-install           Skip npm install
  -h, --help             Show this help message

${pc.bold("Examples:")}
  npm create @modelcontextprotocol/mcp-app
  npm create @modelcontextprotocol/mcp-app my-app
  npm create @modelcontextprotocol/mcp-app my-app --template react
  npm create @modelcontextprotocol/mcp-app my-app --no-install
`);
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(" create-mcp-app ")));

  let projectName = args.projectName;
  let template = args.template;
  const runInstall = !args.noInstall;

  // Prompt for project name if not provided
  if (!projectName) {
    const nameResult = await p.text({
      message: "Project name:",
      placeholder: "my-mcp-app",
      validate: validateProjectName,
    });

    if (p.isCancel(nameResult)) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }

    projectName = nameResult || "my-mcp-app";
  } else {
    const validation = validateProjectName(projectName);
    if (validation) {
      p.cancel(validation);
      process.exit(1);
    }
  }

  // Prompt for template if not provided
  if (!template) {
    const templateResult = await p.select({
      message: "Select a template:",
      options: [...TEMPLATES],
    });

    if (p.isCancel(templateResult)) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }

    template = templateResult as TemplateName;
  } else {
    const validTemplates = TEMPLATES.map((t) => t.value) as readonly string[];
    if (!validTemplates.includes(template)) {
      p.cancel(
        `Invalid template "${template}". Valid options: ${validTemplates.join(", ")}`,
      );
      process.exit(1);
    }
  }

  const s = p.spinner();

  try {
    s.start("Creating project...");

    await scaffold({
      projectName,
      template: template!,
      targetDir: projectName,
      sdkVersion: SDK_VERSION,
    });

    s.stop("Project created!");

    if (runInstall) {
      s.start("Installing dependencies...");
      const { execSync } = await import("node:child_process");
      execSync("npm install", {
        cwd: projectName,
        stdio: "ignore",
      });
      s.stop("Dependencies installed!");
    }

    p.note(
      [
        `cd ${projectName}`,
        ...(runInstall ? [] : ["npm install"]),
        "npm run dev",
      ].join("\n"),
      "Next steps:",
    );

    p.outro(pc.green("Happy building!"));
  } catch (error) {
    s.stop("Failed!");
    throw error;
  }
}
