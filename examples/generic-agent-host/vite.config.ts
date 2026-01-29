import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3004",
      "/app-message": "http://localhost:3004",
      "/update-context": "http://localhost:3004",
      "/clear": "http://localhost:3004",
      "/health": "http://localhost:3004",
      "/tools": "http://localhost:3004",
    },
  },
  build: {
    outDir: "agent/static",
  },
});
