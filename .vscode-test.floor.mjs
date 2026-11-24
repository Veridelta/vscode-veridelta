// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The integration tests on VS Code 1.101.0, the floor that engines.vscode sets.
 *
 * Everything else comes from .vscode-test.mjs. The Upstream workflow runs this with
 * `npx --no -- vscode-test --config .vscode-test.floor.mjs`.
 */

import { defineConfig } from "@vscode/test-cli";
import base from "./.vscode-test.mjs";

export default defineConfig({ ...base, version: "1.101.0" });
