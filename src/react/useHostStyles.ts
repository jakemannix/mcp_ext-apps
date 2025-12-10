import { useEffect, useRef } from "react";
import { App } from "../app";
import { applyHostStyles } from "../styles";
import { McpUiHostContext } from "../types";

/**
 * React hook that applies host styles as CSS custom properties.
 *
 * This hook listens to host context changes and automatically applies the
 * `styles` CSS variables to `document.documentElement`. This allows your
 * app to use the host's theming values via CSS variables like
 * `var(--color-background-primary)`.
 *
 * The hook also applies styles from the initial host context when the app
 * first connects.
 *
 * @param app - The connected App instance, or null during initialization
 * @param initialContext - Initial host context from the connection (optional).
 *   If provided, styles will be applied immediately on mount.
 *
 * @example Basic usage with useApp
 * ```tsx
 * import { useApp } from '@modelcontextprotocol/ext-apps/react';
 * import { useHostStyles } from '@modelcontextprotocol/ext-apps/react';
 *
 * function MyApp() {
 *   const { app, isConnected } = useApp({
 *     appInfo: { name: "MyApp", version: "1.0.0" },
 *     capabilities: {},
 *   });
 *
 *   // Automatically apply host styles as CSS variables
 *   useHostStyles(app);
 *
 *   return (
 *     <div style={{ background: 'var(--color-background-primary)' }}>
 *       Hello!
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With initial context
 * ```tsx
 * const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);
 *
 * // ... get initial context from app.connect() result
 *
 * useHostStyles(app, hostContext);
 * ```
 *
 * @see {@link applyHostStyles} for the underlying function
 * @see {@link McpUiStyles} for available CSS variables
 */
export function useHostStyles(
  app: App | null,
  initialContext?: McpUiHostContext | null,
): void {
  const initialStylesApplied = useRef(false);

  // Apply initial styles once on mount
  useEffect(() => {
    if (initialStylesApplied.current) {
      return;
    }
    if (initialContext?.styles) {
      applyHostStyles(initialContext.styles);
      initialStylesApplied.current = true;
    }
  }, [initialContext]);

  // Listen for host context changes and apply updated styles
  useEffect(() => {
    if (!app) {
      return;
    }

    app.onhostcontextchanged = (params) => {
      if (params.styles) {
        applyHostStyles(params.styles);
      }
    };
  }, [app]);
}
