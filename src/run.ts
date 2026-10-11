// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The run command: run `veridelta run --json --html` on a configuration, then offer the report and the files.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import { artifactPlan, type ArtifactPlan } from "./artifacts";
import { CommandNotFound, RunCancelled, runVeridelta, type Finished } from "./cli";
import { logStderr, messageOf, offerSettings, type Surfaces } from "./notify";
import { openReport } from "./reportView";
import { parseRunOutput, verdictLine, type RunSummary } from "./summary";

/** What a run gave: its summary, the report it wrote, and where its discrepancy files went. */
export interface RunOutcome {
  configFile: string;
  summary: RunSummary;
  reportFile: string;
  /** Where the discrepancy files went, or undefined when the configuration names no `output_path`. */
  artifacts: ArtifactPlan | undefined;
}

const OPEN_REPORT = "Open report";
const OPEN_FILES = "Open discrepancy files";
const SHOW_OUTPUT = "Show output";

/** The `--html-max-rows` words, when the setting holds a whole number. */
function maxRowsArguments(): string[] {
  const rows: unknown = vscode.workspace.getConfiguration("veridelta").get("run.htmlMaxRows");
  return typeof rows === "number" && Number.isInteger(rows) && rows >= 0
    ? ["--html-max-rows", String(rows)]
    : [];
}

/** Where the report goes: the extension's storage, one file per configuration path, so the workspace stays clean. */
async function reportPath(context: vscode.ExtensionContext, configFile: string): Promise<string> {
  const folder = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, "reports");
  await vscode.workspace.fs.createDirectory(folder);
  const hash = createHash("sha256").update(configFile).digest("hex").slice(0, 8);
  return vscode.Uri.joinPath(folder, `${path.parse(configFile).name}-${hash}.html`).fsPath;
}

/** Open the report a run wrote, titled by its configuration. */
export function openReportOf(outcome: RunOutcome): Promise<vscode.WebviewPanel> {
  return openReport(outcome.reportFile, `Veridelta report: ${path.basename(outcome.configFile)}`);
}

/**
 * Open the discrepancy files a run wrote, and return the ones that exist.
 *
 * CSV, JSON, and NDJSON open as text documents. Parquet and Arrow are shown
 * in the Explorer, with a hint naming the format that opens as text.
 */
export async function openArtifacts(plan: ArtifactPlan | undefined): Promise<string[]> {
  if (plan === undefined) {
    void vscode.window.showInformationMessage(
      "This configuration sets no output_path, so the run wrote no discrepancy files.",
    );
    return [];
  }
  const files = plan.candidates
    .map((name) => path.join(plan.folder, name))
    .filter((file) => existsSync(file));
  if (files.length === 0) {
    void vscode.window.showInformationMessage(
      `The run wrote no discrepancy files to ${plan.folder}: no rows differ.`,
    );
    return [];
  }
  if (plan.textual) {
    for (const file of files) {
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, preserveFocus: true });
    }
    return files;
  }
  await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(files[0] ?? plan.folder));
  const noun = files.length === 1 ? "file" : "files";
  void vscode.window.showInformationMessage(
    `The run wrote ${String(files.length)} ${plan.format} ${noun} to ${plan.folder}. Set output_format to csv to open them as text.`,
  );
  return files;
}

/** Offer the report, the discrepancy files, and the output, once the verdict is known. */
async function offerOutcome(outcome: RunOutcome, surfaces: Surfaces): Promise<void> {
  const line = verdictLine(outcome.summary);
  const choice = outcome.summary.isMatch
    ? await vscode.window.showInformationMessage(line, OPEN_REPORT, OPEN_FILES, SHOW_OUTPUT)
    : await vscode.window.showWarningMessage(line, OPEN_REPORT, OPEN_FILES, SHOW_OUTPUT);
  if (choice === OPEN_REPORT) {
    await openReportOf(outcome);
  } else if (choice === OPEN_FILES) {
    await openArtifacts(outcome.artifacts);
  } else if (choice === SHOW_OUTPUT) {
    surfaces.output.show(true);
  }
}

async function showFailure(message: string, surfaces: Surfaces): Promise<void> {
  const choice = await vscode.window.showErrorMessage(message, SHOW_OUTPUT);
  if (choice === SHOW_OUTPUT) {
    surfaces.output.show(true);
  }
}

/**
 * Run the comparison a configuration describes, with a progress notification that can cancel it.
 *
 * The command runs in the configuration's folder, so relative paths resolve as
 * they do on the command line, and the HTML report goes to the extension's
 * storage. The verdict arrives as a notification whose buttons open the report,
 * open the discrepancy files, or show the output. Notifications are not
 * awaited, so the promise settles when the run has.
 *
 * Returns the outcome, or undefined when the run did not give a summary.
 */
export async function runComparison(
  uri: vscode.Uri,
  context: vscode.ExtensionContext,
  surfaces: Surfaces,
): Promise<RunOutcome | undefined> {
  if (uri.scheme !== "file") {
    void vscode.window.showWarningMessage(
      "Veridelta runs a configuration file on disk. Save the document first.",
    );
    return undefined;
  }
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (open?.isDirty === true && !(await open.save())) {
    void vscode.window.showWarningMessage("Veridelta runs the saved file, and the save did not finish.");
    return undefined;
  }
  const configFile = uri.fsPath;
  const folder = path.dirname(configFile);
  const name = path.basename(configFile);
  const reportFile = await reportPath(context, configFile);
  const args = ["run", "-c", configFile, "--json", "--html", reportFile, ...maxRowsArguments()];
  let finished: Finished;
  try {
    finished = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Veridelta: comparing ${name}`,
        cancellable: true,
      },
      (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return runVeridelta(args, folder, { signal: controller.signal });
      },
    );
  } catch (error) {
    if (error instanceof RunCancelled) {
      void vscode.window.showInformationMessage(`Veridelta: the run of ${name} was cancelled.`);
    } else if (error instanceof CommandNotFound) {
      void offerSettings(`${error.message} Set veridelta.command to the words that run it.`);
    } else {
      void vscode.window.showErrorMessage(`Veridelta could not start: ${messageOf(error)}`);
    }
    return undefined;
  }
  logStderr(surfaces.output, finished.stderr);
  const parsed = parseRunOutput(finished.stdout, finished.code);
  if (parsed.kind === "unparsable") {
    const detail = finished.stderr.trim() || finished.stdout.trim() || `exit code ${String(finished.code)}`;
    void showFailure(`Veridelta gave no summary to read: ${detail}`, surfaces);
    return undefined;
  }
  if (parsed.kind === "error") {
    void showFailure(`Veridelta: ${parsed.error.type}: ${parsed.error.message}`, surfaces);
    return undefined;
  }
  const configText = await readFile(configFile, "utf8");
  const outcome: RunOutcome = {
    configFile,
    summary: parsed.summary,
    reportFile,
    artifacts: artifactPlan(configText, folder),
  };
  void offerOutcome(outcome, surfaces);
  return outcome;
}
