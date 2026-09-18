import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing data-boundary code still narrows dynamic Firebase payloads.
      // Keep these visible without making the entire lint gate unusable.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "tests/**/*.ts"],
    rules: {
      // Operational scripts and emulator tests intentionally run as CommonJS.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".local/**",
    ".tmp/**",
    "tmp/**",
    "functions/lib/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
