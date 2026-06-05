import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/install-mcps.sh",
  ]),
  {
    rules: {
      // React 19 flags common "derive client state after mount" patterns
      // that this app still uses for hydration-safe UI and request-driven
      // data. Keep lint useful for the alpha release; revisit when those
      // flows are refactored.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
