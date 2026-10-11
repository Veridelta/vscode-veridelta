// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import * as vscode from "vscode";

import type { Api } from "../../src/extension";

const run = promisify(execFile);

function workspaceFolder(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the fixture workspace is open");
  return folder.uri;
}

async function open(name: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceFolder(), name));
}

async function extension(): Promise<Api> {
  const found = vscode.extensions.getExtension<Api>("veridelta.vscode-veridelta");
  assert.ok(found, "the extension is in the test host");
  return found.activate();
}

describe("Veridelta: Validate configuration", function () {
  this.timeout(60_000);

  before(async () => {
    try {
      await run("veridelta", ["--version"]);
    } catch (error) {
      assert.fail(`veridelta is not on PATH, and the integration tests need it: ${String(error)}`);
    }
  });

  it("shows no problem for a valid configuration", async () => {
    const document = await open("veridelta.yaml");
    const api = await extension();
    assert.deepEqual(await api.validateDocument(document), []);
    assert.deepEqual(vscode.languages.getDiagnostics(document.uri), []);
  });

  it("places an unknown format on the line that sets it", async () => {
    const document = await open("broken.yaml");
    const api = await extension();
    const diagnostics = await api.validateDocument(document);
    assert.equal(diagnostics.length, 1);
    const [problem] = diagnostics;
    assert.ok(problem);
    assert.equal(problem.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(problem.source, "veridelta");
    assert.match(problem.message, /format/);
    assert.match(document.lineAt(problem.range.start.line).text, /format: parquett/);
    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 1);
  });

  it("reports a file that does not parse", async () => {
    const document = await open("unparsable.yaml");
    const api = await extension();
    const diagnostics = await api.validateDocument(document);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Error);
  });

  it("runs from the Command Palette on the active editor", async () => {
    const document = await open("broken.yaml");
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("veridelta.validate");
    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 1);
  });
});
