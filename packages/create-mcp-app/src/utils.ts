import path from "node:path";
import { fileURLToPath } from "node:url";

/** Current SDK version - used in generated package.json files */
export const SDK_VERSION = "0.4.1";

/** Available templates */
export const TEMPLATES = [
  { value: "react", label: "React", hint: "React + Vite + TypeScript" },
  {
    value: "vanillajs",
    label: "Vanilla JS",
    hint: "Vanilla JavaScript + Vite + TypeScript",
  },
] as const;

export type TemplateName = (typeof TEMPLATES)[number]["value"];

/** Get the templates directory path */
export function getTemplatesDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Works both in development (src/) and production (dist/)
  return path.join(__dirname, "..", "templates");
}

/** Validate project name */
export function validateProjectName(name: string): string | undefined {
  if (!name) {
    return undefined; // Allow empty for placeholder default
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(name)) {
    return "Project name must be lowercase alphanumeric with optional hyphens";
  }

  if (name.length > 214) {
    return "Project name is too long (max 214 characters)";
  }

  return undefined;
}

/** Process template placeholders in content */
export function processTemplate(
  content: string,
  replacements: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}
