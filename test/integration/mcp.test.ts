// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";

import * as vscode from "vscode";

import { extension, workspaceFolder } from "./helpers";

const SETTING = "allowRowValues";

/** Resolve when the provider announces a change, or fail after a while. */
function nextChange(event: vscode.Event<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error("the provider announced no change"));
    }, 10_000);
    const subscription = event(() => {
      clearTimeout(timer);
      subscription.dispose();
      resolve();
    });
  });
}

describe("Veridelta in agent mode", function () {
  this.timeout(60_000);

  afterEach(async () => {
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update(SETTING, undefined, vscode.ConfigurationTarget.Workspace);
  });

  it("offers one server rooted at the workspace folder", async () => {
    const api = await extension();
    const definitions = api.mcpProvider.provideMcpServerDefinitions();
    assert.equal(definitions.length, 1);
    const [server] = definitions;
    assert.ok(server);
    assert.equal(server.label, "Veridelta");
    assert.equal(server.command, "veridelta");
    assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath]);
    assert.equal(server.cwd?.fsPath, workspaceFolder().fsPath);
  });

  it("fills in the installed version when agent mode resolves the server", async () => {
    const api = await extension();
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    const resolved = await api.mcpProvider.resolveMcpServerDefinition(server);
    assert.match(resolved.version ?? "", /^\d+\.\d+\.\d+$/);
  });

  it("adds the flag and announces a change when a setting turns on", async () => {
    const api = await extension();
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update(SETTING, true, vscode.ConfigurationTarget.Workspace);
    await changed;
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath, "--allow-row-values"]);
  });
});
