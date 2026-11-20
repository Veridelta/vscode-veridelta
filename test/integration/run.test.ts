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

import { recentNotifications, withProgress } from "../../src/notify";
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
    const out = path.join(workspaceFolder().fsPath, "out");
    fs.rmSync(out, { recursive: true, force: true });
    // A keys-only file an earlier run compared where the data is stored would leave.
    fs.mkdirSync(out);
    const stale = path.join(out, "added_rows_pks_only.csv");
    fs.writeFileSync(stale, "id\n9\n");
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(stale, hourAgo, hourAgo);
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const opened = await api.openArtifacts(outcome);
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["added_rows.csv", "removed_rows.csv", "changed_rows.csv"],
    );
  });

  it("leaves an earlier notification's files closed once a later run replaced them", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const earlier = await api.runComparison(fixture("with_output.yaml"));
    const later = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(earlier?.artifacts && later?.artifacts);
    assert.deepEqual(await api.openArtifacts(earlier), []);
    assert.match(api.notifications().at(-1) ?? "", /later run/);
    assert.equal((await api.openArtifacts(later)).length, 3);
  });

  it("opens the files it can, and names one that changed after the run", async () => {
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
    assert.match(api.notifications().at(-1) ?? "", /added_rows\.csv changed after this run wrote it/);
  });

  it("names a folder found at a file's name, and opens the rest", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const added = path.join(outcome.artifacts.folder, "added_rows.csv");
    fs.rmSync(added);
    fs.mkdirSync(added);
    // As if the run had left a folder there, so the check after the stamps runs.
    const { mtimeMs, size } = fs.statSync(added);
    const opened = await api.openArtifacts({
      ...outcome,
      written: { ...outcome.written, [added]: { mtimeMs, size } },
    });
    assert.deepEqual(
      opened.map((file) => path.basename(file)),
      ["removed_rows.csv", "changed_rows.csv"],
    );
    assert.match(api.notifications().at(-1) ?? "", /added_rows\.csv is not a file/);
  });

  it("says a file is gone rather than guessing why", async () => {
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    fs.rmSync(outcome.artifacts.folder, { recursive: true, force: true });
    assert.deepEqual(await api.openArtifacts(outcome), []);
    const message = api.notifications().at(-1) ?? "";
    assert.match(message, /added_rows\.csv is gone/);
    assert.doesNotMatch(message, /replaced/);
  });

  it("does not follow a link at a file's name out of the workspace", async function () {
    if (process.platform === "win32") {
      // Creating a link needs privileges a Windows runner may not have.
      this.skip();
    }
    fs.rmSync(path.join(workspaceFolder().fsPath, "out"), { recursive: true, force: true });
    const api = await extension();
    const outcome = await api.runComparison(fixture("with_output.yaml"));
    assert.ok(outcome?.artifacts);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "veridelta-outside-"));
    try {
      // Veridelta 0.42.2 writes through a link planted at a file's name, so the run's stamp is the
      // link's target. This test builds that outcome whichever Veridelta runs.
      const target = path.join(outside, "elsewhere.csv");
      fs.writeFileSync(target, "id\n1\n");
      const added = path.join(outcome.artifacts.folder, "added_rows.csv");
      fs.rmSync(added);
      fs.symlinkSync(target, added);
      const { mtimeMs, size } = fs.statSync(added);
      const opened = await api.openArtifacts({
        ...outcome,
        written: { ...outcome.written, [added]: { mtimeMs, size } },
      });
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

  it("breaks links in a progress message too", async () => {
    await withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Veridelta: test" },
      (progress) => {
        progress.report({ message: "reading [Open](command:workbench.action.terminal.new)" });
        return Promise.resolve();
      },
    );
    const shown = recentNotifications().find((message) => message.startsWith("reading"));
    assert.equal(shown, "reading [Open] (command:workbench.action.terminal.new)");
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
