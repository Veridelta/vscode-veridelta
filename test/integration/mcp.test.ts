// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

import * as vscode from "vscode";

import { extension, workspaceFolder } from "./helpers";

const SETTING = "allowRowValues";

const run = promisify(execFile);

/** Wait until a condition holds, or fail after a while. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 10_000; waited += 100) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting until ${what}`);
}

/** Whether the Veridelta on PATH takes `veridelta mcp --allow-host`. */
async function takesAllowHostOnPath(): Promise<boolean> {
  const { stdout } = await run("veridelta", ["mcp", "--help"]);
  return stdout.includes("--allow-host");
}

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
    const configuration = vscode.workspace.getConfiguration("veridelta.mcp");
    await configuration.update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    await configuration.update("allowHosts", undefined, vscode.ConfigurationTarget.Global);
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
      .update(SETTING, true, vscode.ConfigurationTarget.Global);
    await changed;
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath, "--allow-row-values"]);
  });

  it("passes the hosts user settings allow, and leaves them out for a Veridelta without --allow-host", async () => {
    const api = await extension();
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update("allowHosts", ["db.internal"], vscode.ConfigurationTarget.Global);
    await changed;
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath, "--allow-host=db.internal"]);
    const resolved = await api.mcpProvider.resolveMcpServerDefinition(server);
    const expected = (await takesAllowHostOnPath())
      ? ["mcp", "--root", workspaceFolder().fsPath, "--allow-host=db.internal"]
      : ["mcp", "--root", workspaceFolder().fsPath];
    assert.deepEqual(resolved.args, expected);
  });

  it("ignores what a repository's own settings grant the agent", async () => {
    const api = await extension();
    const file = path.join(workspaceFolder().fsPath, ".vscode", "settings.json");
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // htmlMaxRows is a setting a workspace may set, so it shows when the file has been read.
    fs.writeFileSync(
      file,
      JSON.stringify({
        "veridelta.mcp.allowHosts": ["attacker.example"],
        "veridelta.mcp.allowRowValues": true,
        "veridelta.mcp.allowQueries": true,
        "veridelta.mcp.maxRows": 1_000_000,
        "veridelta.run.htmlMaxRows": 7,
      }),
    );
    const htmlMaxRows = (): unknown => vscode.workspace.getConfiguration("veridelta.run").get("htmlMaxRows");
    try {
      await until(() => htmlMaxRows() === 7, "the workspace settings are read");
      const [server] = api.mcpProvider.provideMcpServerDefinitions();
      assert.ok(server);
      assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath]);
    } finally {
      if (before === undefined) {
        fs.rmSync(file);
      } else {
        fs.writeFileSync(file, before);
      }
      await until(() => htmlMaxRows() !== 7, "the workspace settings are restored");
    }
  });
});
