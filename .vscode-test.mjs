// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/integration/**/*.test.js",
  workspaceFolder: "./test/fixtures/workspace",
  version: "stable",
  launchArgs: ["--disable-extensions"],
  mocha: { ui: "bdd", timeout: 60_000 },
});
