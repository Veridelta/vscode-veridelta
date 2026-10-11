// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import type { RunOutcome } from "../../src/run";
import { extension, fixture, openFixture, workspaceFolder } from "./helpers";

describe("Veridelta: Run comparison", function () {
  this.timeout(120_000);

  it("runs the quick start and reports its drift", async () => {
    const api = await extension();
    const outcome = await api.runComparison(fixture("veridelta.yaml"));
    assert.ok(outcome);
    assert.equal(outcome.summary.isMatch, false);
    assert.deepEqual([outcome.summary.added, outcome.summary.removed, outcome.summary.changed], [1, 1, 1]);
    assert.ok(fs.existsSync(outcome.reportFile), "the run wrote the report");
    assert.ok(fs.readFileSync(outcome.reportFile, "utf8").startsWith("<!DOCTYPE html>"));
    assert.equal(outcome.artifacts, undefined);
  });

  it("opens the report in a webview behind a content security policy", async () => {
    const api = await extension();
    const outcome = await api.runComparison(fixture("veridelta.yaml"));
    assert.ok(outcome);
    const panel = await api.openReport(outcome);
    try {
      assert.equal(panel.title, "Veridelta report: veridelta.yaml");
      assert.match(panel.webview.html, /http-equiv="Content-Security-Policy"/);
      assert.equal((panel.webview.html.match(/ nonce="/g) ?? []).length, 2);
    } finally {
      panel.dispose();
    }
  });

  it("opens the discrepancy files a configuration asks for", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    assert.equal(outcome.artifacts.format, "csv");
    const opened = await api.openArtifacts(outcome.artifacts);
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["added_rows.csv", "removed_rows.csv", "changed_rows.csv"],
    );
    assert.ok(
      vscode.workspace.textDocuments.some((document) => document.uri.fsPath.endsWith("changed_rows.csv")),
    );
  });

  it("gives nothing for a configuration that does not load", async () => {
    const api = await extension();
    assert.equal(await api.runComparison(fixture("broken.yaml")), undefined);
  });

  it("runs from the Command Palette on the active editor", async () => {
    const document = await openFixture("veridelta.yaml");
    await vscode.window.showTextDocument(document);
    const outcome = await vscode.commands.executeCommand<RunOutcome | undefined>("veridelta.run");
    assert.equal(outcome?.summary.changed, 1);
  });
});
