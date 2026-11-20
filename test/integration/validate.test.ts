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

import { validateDocument } from "../../src/validate";
import { extension, openFixture } from "./helpers";

const run = promisify(execFile);

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
    const document = await openFixture("veridelta.yaml");
    const api = await extension();
    assert.deepEqual(await api.validateDocument(document), []);
    assert.deepEqual(vscode.languages.getDiagnostics(document.uri), []);
  });

  it("places an unknown format on the line that sets it", async () => {
    const document = await openFixture("broken.yaml");
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
    const document = await openFixture("unparsable.yaml");
    const api = await extension();
    const diagnostics = await api.validateDocument(document);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Error);
  });

  it("clears the problems when a later validate cannot start", async () => {
    const document = await openFixture("broken.yaml");
    const api = await extension();
    assert.equal((await api.validateDocument(document)).length, 1);
    const configuration = vscode.workspace.getConfiguration("veridelta");
    await configuration.update(
      "command",
      ["veridelta-not-installed-here"],
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      assert.deepEqual(await api.validateDocument(document), []);
      assert.deepEqual(vscode.languages.getDiagnostics(document.uri), []);
    } finally {
      await configuration.update("command", undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it("keeps only the newest of two validates of one file", async () => {
    const document = await openFixture("broken.yaml");
    const api = await extension();
    api.diagnostics.delete(document.uri);
    const older = api.validateDocument(document);
    const newer = api.validateDocument(document);
    assert.deepEqual(await older, [], "the older validate gives way");
    assert.equal((await newer).length, 1);
    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 1);
  });

  it("sends output it cannot read to the Veridelta output", async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "veridelta-garbled-"));
    const script = path.join(scratch, "garbled.js");
    fs.writeFileSync(
      script,
      'process.stderr.write("a warning\\n"); process.stdout.write("not json [Open](command:x)\\n");',
    );
    const configuration = vscode.workspace.getConfiguration("veridelta");
    await configuration.update("command", ["node", script], vscode.ConfigurationTarget.Workspace);
    const lines: string[] = [];
    const output = { appendLine: (line: string) => lines.push(line) } as unknown as vscode.OutputChannel;
    const diagnostics = vscode.languages.createDiagnosticCollection("veridelta-test");
    try {
      const document = await openFixture("veridelta.yaml");
      assert.deepEqual(await validateDocument(document, { diagnostics, output }), []);
      assert.ok(lines.includes("a warning"), lines.join("\n"));
      assert.ok(lines.includes("not json [Open](command:x)"), lines.join("\n"));
    } finally {
      diagnostics.dispose();
      await configuration.update("command", undefined, vscode.ConfigurationTarget.Workspace);
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("runs from the Command Palette on the active editor", async () => {
    const document = await openFixture("broken.yaml");
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("veridelta.validate");
    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 1);
  });
});
