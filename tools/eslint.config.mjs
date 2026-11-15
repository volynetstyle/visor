import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/node_modules/**", "**/build/**", "**/generated/**"] },
  {
    files: ["**/*.ts", "**/*.cts"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
