// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// The window functions whose text VS Code renders with `[label](command:...)` links.
const RENDERED =
  "/^(show(Error|Warning|Information)Message|withProgress|showInputBox|createInputBox|createQuickPick)$/";
const THROUGH_NOTIFY =
  "Show notifications, progress and input prompts through src/notify.ts, which keeps links out of the text.";

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
        { selector: `MemberExpression[property.name=${RENDERED}]`, message: THROUGH_NOTIFY },
        // `const { showErrorMessage } = vscode.window` would pass the rule above.
        { selector: `ObjectPattern > Property[key.name=${RENDERED}]`, message: THROUGH_NOTIFY },
        // So would the names written as strings, or read with Reflect.
        { selector: `ObjectPattern > Property[key.value=${RENDERED}]`, message: THROUGH_NOTIFY },
        { selector: `MemberExpression[property.value=${RENDERED}]`, message: THROUGH_NOTIFY },
        {
          selector: `CallExpression[callee.object.name="Reflect"] > Literal[value=${RENDERED}]`,
          message: THROUGH_NOTIFY,
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
