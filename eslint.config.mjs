// Flat config, imported directly. NOT via FlatCompat: eslint-config-next 16
// ships flat-config arrays natively, and routing them through the eslintrc
// compatibility shim makes its schema validator throw on eslint 10 — which
// presents as a stack trace from inside node_modules and reads like an eslint
// bug rather than a config mistake.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "next-env.d.ts",
      ".data/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Pinned rather than "detect". eslint-config-next carries its own nested
    // copy of eslint-plugin-react, whose version sniffing cannot resolve React
    // from there and throws mid-rule — which surfaces as a stack trace inside
    // node_modules with no mention of a missing setting.
    settings: { react: { version: "19.3" } },
    rules: {
      // An error, not a warning. A warning in a repository this young is one
      // nobody will ever read; the predecessor failed CI on unused imports left
      // behind by a rewrite, having run tsc and the tests but not the linter.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
