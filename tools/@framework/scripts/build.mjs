import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const core = fileURLToPath(new URL("../src/quant-core.ts", import.meta.url));
await build({
  entryPoints: ["src/index.ts", "src/frame.ts", "src/jsx-runtime.ts", "src/compiler.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["reflex-quant"],
  alias: { rxcore: core },
  sourcemap: true,
});
