import { McpUiStyles } from "./types";

/**
 * Apply host styles as CSS custom properties on an element.
 *
 * This function takes the `styles` object from `McpUiHostContext` and sets
 * each CSS variable on the specified root element (defaults to `document.documentElement`).
 * This allows apps to use the host's theming values via CSS variables like
 * `var(--color-background-primary)`.
 *
 * @param styles - The styles object from `McpUiHostContext.styles`
 * @param root - The element to apply styles to (defaults to `document.documentElement`)
 *
 * @example Apply styles from host context
 * ```typescript
 * import { applyHostStyles } from '@modelcontextprotocol/ext-apps';
 *
 * app.onhostcontextchanged = (params) => {
 *   if (params.styles) {
 *     applyHostStyles(params.styles);
 *   }
 * };
 * ```
 *
 * @example Apply to a specific element
 * ```typescript
 * const container = document.getElementById('app-root');
 * applyHostStyles(hostContext.styles, container);
 * ```
 *
 * @see {@link McpUiStyles} for the available CSS variables
 * @see {@link McpUiHostContext} for the full host context structure
 */
export function applyHostStyles(
  styles: McpUiStyles,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(styles)) {
    root.style.setProperty(key, value);
  }
}
