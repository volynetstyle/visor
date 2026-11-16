const fs = require("node:fs");
const path = require("node:path");
const babel = require("@babel/core");
const jsx = require("babel-plugin-jsx-dom-expressions");
const esbuild = require("esbuild");
const root = __dirname;
const destination = path.resolve(root, "../../build/quant-dom");
async function build(entry = "compiled-demo.jsx", name = "compiled") {
  const { jsxOptions } = await import("@visor/framework/compiler");
  fs.mkdirSync(destination, { recursive: true });
  const result = babel.transformFileSync(path.join(root, entry), {
    configFile: false,
    babelrc: false,
    plugins: [[jsx, jsxOptions()]],
  });
  fs.writeFileSync(path.join(destination, `${name}-source.js`), result.code);
  await esbuild
    .build({
      stdin: { contents: result.code, resolveDir: root, sourcefile: "compiled-demo.jsx" },
      outfile: path.join(destination, `${name}.js`),
      bundle: true,
      format: "esm",
      minify: true,
      metafile: true,
    })
    .then((result) =>
      fs.writeFileSync(
        path.join(destination, `${name}-meta.json`),
        JSON.stringify(result.metafile, null, 2),
      ),
    );
}
module.exports = build;
if (require.main === module)
  build().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
