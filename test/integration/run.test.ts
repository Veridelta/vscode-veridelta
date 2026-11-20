// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs inside VS Code on test/fixtures/workspace, with `veridelta` on PATH.
 */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
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

  it("gives each run its own report, and keeps the newest few", async () => {
    const api = await extension();
    const first = await api.runComparison(fixture("veridelta.yaml"));
    const second = await api.runComparison(fixture("veridelta.yaml"));
    assert.ok(first && second);
    assert.notEqual(first.reportFile, second.reportFile);
    assert.ok(fs.existsSync(first.reportFile), "the earlier run's report stays");
    for (let run = 0; run < 5; run += 1) {
      await api.runComparison(fixture("veridelta.yaml"));
    }
    const prefix = path.basename(second.reportFile).replace(/[^-]+\.html$/, "");
    const kept = fs.readdirSync(path.dirname(second.reportFile)).filter((name) => name.startsWith(prefix));
    assert.equal(kept.length, 5);
  });

  it("writes a report that needs nothing its policy forbids", async () => {
    const api = await extension();
    const outcome = await api.runComparison(fixture("veridelta.yaml"));
    assert.ok(outcome);
    const html = fs.readFileSync(outcome.reportFile, "utf8");
    // The data is escaped, so every tag here comes from Veridelta's own template or script.
    const tags = html.match(/<[a-zA-Z][^>]*>/g) ?? [];
    const forbidden = tags.filter(
      (tag) =>
        /^<(link|iframe|object|embed|base|form)\b/i.test(tag) ||
        /\sstyle\s*=/i.test(tag) ||
        /\son[a-z]+\s*=/i.test(tag) ||
        /\ssrc\s*=\s*(?!["']?data:)/i.test(tag),
    );
    assert.deepEqual(forbidden, [], "the policy allows only data: images and the nonce'd style and script");
    const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    assert.doesNotMatch(styles, /@import|url\(\s*(?!["']?data:)/i);
  });

  it("opens no empty tab for a report it will not show", async () => {
    const api = await extension();
    const outcome = await api.runComparison(fixture("veridelta.yaml"));
    assert.ok(outcome);
    const reportTabs = (): number =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.label.startsWith("Veridelta report")).length;
    const before = reportTabs();
    fs.writeFileSync(outcome.reportFile, "<!DOCTYPE html><style></style><style></style>");
    await assert.rejects(api.openReport(outcome), /not the document Veridelta writes/);
    fs.rmSync(outcome.reportFile);
    await assert.rejects(api.openReport(outcome), /no longer there/);
    assert.equal(reportTabs(), before);
  });

  it("opens the discrepancy files a configuration asks for", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    assert.equal(outcome.artifacts.format, "csv");
    const opened = await api.openArtifacts(outcome);
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["added_rows.csv", "removed_rows.csv", "changed_rows.csv"],
    );
    assert.ok(
      vscode.workspace.textDocuments.some((document) => document.uri.fsPath.endsWith("changed_rows.csv")),
    );
  });

  it("shows Veridelta's error with no link a click would follow", async () => {
    // VS Code's own pattern for a link in a notification, from its linkedText parser.
    const link = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)(\3))?\)/i;
    const api = await extension();
    assert.equal(await api.runComparison(fixture("linked.yaml")), undefined);
    const message = api.notifications().at(-1) ?? "";
    assert.match(message, /command:workbench\.action\.terminal\.new/, "the message names the column read");
    assert.doesNotMatch(message, link);
  });

  it("opens no file an earlier run left behind", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const failed = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(failed?.artifacts);
    const passed = await api.runComparison(fixture("same_output.yaml"));
    assert.ok(passed?.artifacts);
    assert.equal(passed.summary.isMatch, true);
    assert.deepEqual(await api.openArtifacts(passed), [], "a clean run wrote nothing to open");
  });

  it("skips a file older than the run that asks for it", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(outcome.artifacts.folder, "added_rows.csv"), hourAgo, hourAgo);
    const opened = await api.openArtifacts(outcome);
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["removed_rows.csv", "changed_rows.csv"],
    );
  });

  it("opens the files it can, and names a folder at a file's name", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const added = path.join(outcome.artifacts.folder, "added_rows.csv");
    fs.rmSync(added);
    fs.mkdirSync(added);
    const opened = await api.openArtifacts(outcome);
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["removed_rows.csv", "changed_rows.csv"],
    );
    assert.match(api.notifications().at(-1) ?? "", /added_rows\.csv is not a file/);
  });

  it("does not follow a link at a file's name out of the workspace", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "veridelta-outside-"));
    try {
      const target = path.join(outside, "elsewhere.csv");
      fs.writeFileSync(target, "id\n1\n");
      const added = path.join(outcome.artifacts.folder, "added_rows.csv");
      fs.rmSync(added);
      fs.symlinkSync(target, added);
      const opened = await api.openArtifacts(outcome);
      assert.deepEqual(
        opened.map((file) => path.basename(file)),
        ["removed_rows.csv", "changed_rows.csv"],
      );
      assert.ok(!vscode.workspace.textDocuments.some((document) => document.uri.fsPath === target));
      assert.match(api.notifications().at(-1) ?? "", /added_rows\.csv links outside the workspace/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
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
