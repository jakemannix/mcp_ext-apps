import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sandboxCspPlugin } from "./vite-plugin-sandbox-csp";

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === "development";
  return {
    plugins: [react(), sandboxCspPlugin()],
    build: {
      sourcemap: isDevelopment ? "inline" : undefined,
      cssMinify: !isDevelopment,
      minify: !isDevelopment,
      rollupOptions: {
        input: [
          "index.html",
          "example-host-vanilla.html",
          "example-host-react.html",
          "sandbox.html",
        ],
      },
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
