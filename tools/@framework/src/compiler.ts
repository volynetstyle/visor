/** Options for babel-plugin-jsx-dom-expressions. Use with jsx: preserve in TS. */
export function jsxOptions(moduleName = "@visor/framework") {
  return { moduleName, generate: "dom" as const, delegateEvents: false };
}
