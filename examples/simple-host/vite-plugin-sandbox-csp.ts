import type { Plugin, Connect } from "vite";
import type { ServerResponse, IncomingMessage } from "http";
import { parse as parseUrl } from "url";

/**
 * Vite plugin that serves sandbox.html with dynamic CSP headers.
 *
 * CSP directives can be customized via query params to support
 * resource-specific CSP settings from `_meta.ui.csp`.
 *
 * Example: /sandbox.html?script-src=https://cdn.example.com&connect-src=https://api.example.com
 */
export function sandboxCspPlugin(): Plugin {
  return {
    name: "sandbox-csp",
    configureServer(server) {
      server.middlewares.use(
        (
          req: Connect.IncomingMessage,
          res: ServerResponse<IncomingMessage>,
          next: Connect.NextFunction,
        ) => {
          const parsedUrl = parseUrl(req.url || "", true);
          const pathname = parsedUrl.pathname;

          // Only handle sandbox.html requests
          if (pathname !== "/sandbox.html" && pathname !== "/sandbox") {
            return next();
          }

          // Extract CSP customizations from query params
          const scriptSrc = parsedUrl.query["script-src"] as string | undefined;
          const connectSrc = parsedUrl.query["connect-src"] as
            | string
            | undefined;

          // Build CSP with defaults, allowing query param overrides
          const csp = [
            "default-src 'self'",
            "img-src * data: blob: 'unsafe-inline'",
            "style-src * blob: data: 'unsafe-inline'",
            `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:${scriptSrc ? ` ${scriptSrc}` : ""}`,
            `connect-src 'self'${connectSrc ? ` ${connectSrc}` : ""}`,
            "font-src * blob: data:",
            "media-src * blob: data:",
            "frame-src 'self' blob: data:",
            "base-uri 'self'",
          ].join("; ");

          res.setHeader("Content-Security-Policy", csp);
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");

          // Let Vite handle the actual file serving
          next();
        },
      );
    },
  };
}
