// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

  // This test runs first in the file, so no probe has run in this session yet.
  it("offers no host before it knows the installed Veridelta takes them", async () => {
    const api = await extension();
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update("allowHosts", ["db.internal"], vscode.ConfigurationTarget.Global);
    await changed;
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath]);
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
    assert.ok(resolved);
    assert.match(resolved.version ?? "", /^\d+\.\d+\.\d+$/);
  });

  it("starts the server with the settings as they are, not as VS Code kept them", async () => {
    const api = await extension();
    const [kept] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(kept);
    const keptArgs = [...kept.args];
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update(SETTING, true, vscode.ConfigurationTarget.Global);
    await changed;
    const resolved = await api.mcpProvider.resolveMcpServerDefinition(kept);
    assert.ok(resolved);
    assert.notEqual(resolved, kept, "the definition VS Code kept is left as it was");
    assert.deepEqual(kept.args, keptArgs);
    assert.deepEqual(resolved.args, ["mcp", "--root", workspaceFolder().fsPath, "--allow-row-values"]);
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
    const takes = await takesAllowHostOnPath();
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update("allowHosts", ["db.internal"], vscode.ConfigurationTarget.Global);
    await changed;
    const root = ["mcp", "--root", workspaceFolder().fsPath];
    const expected = takes ? [...root, "--allow-host=db.internal"] : root;
    await until(
      () =>
        JSON.stringify(api.mcpProvider.provideMcpServerDefinitions()[0]?.args) === JSON.stringify(expected),
      "the offer follows the probe",
    );
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    const resolved = await api.mcpProvider.resolveMcpServerDefinition(server);
    assert.ok(resolved);
    assert.deepEqual(resolved.args, expected);
    if (!takes) {
      assert.ok(
        api.notifications().some((message) => message.includes("has no --allow-host")),
        "a notification says what the installed Veridelta does not hold",
      );
    }
  });

  it("probes again at the next start when a probe could not tell", async () => {
    const api = await extension();
    // A command that fails its first `mcp --help`, as a first `uv run` that times out would,
    // and runs the real Veridelta after that. It logs each call.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "veridelta-probe-"));
    const calls = path.join(scratch, "calls.log");
    const script = path.join(scratch, "flaky.js");
    fs.writeFileSync(
      script,
      [
        'const fs = require("fs");',
        `const calls = ${JSON.stringify(calls)};`,
        "const args = process.argv.slice(2);",
        'fs.appendFileSync(calls, args.join(" ") + "\\n");',
        'const helps = fs.readFileSync(calls, "utf8").split("\\n").filter((line) => line.endsWith("--help")).length;',
        'if (args.includes("--help") && helps === 1) { process.exit(1); }',
        'const run = require("child_process").spawnSync("veridelta", args, { stdio: "inherit", shell: process.platform === "win32" });',
        "process.exit(run.status ?? 1);",
      ].join("\n"),
    );
    const root = vscode.workspace.getConfiguration("veridelta");
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await root.update("command", ["node", script], vscode.ConfigurationTarget.Global);
    await changed;
    try {
      const [server] = api.mcpProvider.provideMcpServerDefinitions();
      assert.ok(server);
      assert.ok(await api.mcpProvider.resolveMcpServerDefinition(server));
      assert.ok(await api.mcpProvider.resolveMcpServerDefinition(server));
      const helps = fs
        .readFileSync(calls, "utf8")
        .split("\n")
        .filter((line) => line.endsWith("--help"));
      assert.equal(helps.length, 2, "the failed probe is not kept as an answer");
    } finally {
      await root.update("command", undefined, vscode.ConfigurationTarget.Global);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("leaves out a host Veridelta would refuse, and names it", async () => {
    const api = await extension();
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await vscode.workspace
      .getConfiguration("veridelta.mcp")
      .update("allowHosts", ["db.internal", "https://bad.example"], vscode.ConfigurationTarget.Global);
    await changed;
    const [server] = api.mcpProvider.provideMcpServerDefinitions();
    assert.ok(server);
    assert.ok(!server.args.some((arg) => arg.includes("bad.example")), server.args.join(" "));
    assert.ok(
      api.notifications().some((message) => message.includes("https://bad.example")),
      "a notification names the host left out",
    );
  });

  it("sets and removes the variables user settings name, for the server alone", async () => {
    const api = await extension();
    const configuration = vscode.workspace.getConfiguration("veridelta.mcp");
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await configuration.update(
      "env",
      { POLARS_TEMP_DIR: "/tmp/polars", PIP_INDEX_URL: null },
      vscode.ConfigurationTarget.Global,
    );
    try {
      await changed;
      const [server] = api.mcpProvider.provideMcpServerDefinitions();
      assert.ok(server);
      assert.deepEqual(server.env, { POLARS_TEMP_DIR: "/tmp/polars", PIP_INDEX_URL: null });
    } finally {
      await configuration.update("env", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it("starts the server with the command a trusted workspace names, as the README says", async () => {
    const api = await extension();
    const root = vscode.workspace.getConfiguration("veridelta");
    const changed = nextChange(api.mcpProvider.onDidChangeMcpServerDefinitions);
    await root.update("command", ["uv", "run", "veridelta"], vscode.ConfigurationTarget.Workspace);
    try {
      await changed;
      const [server] = api.mcpProvider.provideMcpServerDefinitions();
      assert.ok(server);
      assert.equal(server.command, "uv");
      assert.deepEqual(server.args.slice(0, 3), ["run", "veridelta", "mcp"]);
    } finally {
      await root.update("command", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it("ignores what a workspace's settings grant the agent", async () => {
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
        "veridelta.mcp.env": { LD_PRELOAD: "/tmp/x.so" },
        "veridelta.run.htmlMaxRows": 7,
      }),
    );
    const htmlMaxRows = (): unknown => vscode.workspace.getConfiguration("veridelta.run").get("htmlMaxRows");
    try {
      await until(() => htmlMaxRows() === 7, "the workspace settings are read");
      const [server] = api.mcpProvider.provideMcpServerDefinitions();
      assert.ok(server);
      assert.deepEqual(server.args, ["mcp", "--root", workspaceFolder().fsPath]);
      assert.deepEqual(server.env, {});
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
