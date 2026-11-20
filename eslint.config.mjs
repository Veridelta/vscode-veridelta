// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/", "out/", ".vscode-test/", "node_modules/"]),
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
    rules: {
      curly: "error",
      eqeqeq: "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    // A notification turns `[label](command:...)` into a link that runs a command.
    // Messages carry text from configurations and data, so they go through
    // src/notify.ts, which breaks every link before anything is shown.
    files: ["src/**/*.ts"],
    ignores: ["src/notify.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name=/^(show(Error|Warning|Information)Message|withProgress)$/]",
          message:
            "Show notifications and progress through src/notify.ts, which keeps links out of the text.",
        },
      ],
    },
  },
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
  },
);
