// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The run command: run `veridelta run --json --html` on a configuration, then offer the report and the files.
 */

import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import { artifactPlan, candidatesFor, type ArtifactPlan } from "./artifacts";
import { CommandNotFound, RunCancelled, runVeridelta, type Finished } from "./cli";
import {
  logStderr,
  messageOf,
  offerSettings,
  showError,
  showInformation,
  showWarning,
  withProgress,
  type Surfaces,
} from "./notify";
import { openReport, ReportMissing } from "./reportView";
import { parseRunOutput, verdictLine, type RunSummary } from "./summary";

/** What a run gave: its summary, the report it wrote, and where its discrepancy files went. */
export interface RunOutcome {
  configFile: string;
  summary: RunSummary;
  reportFile: string;
  /** Where the discrepancy files went, or undefined when the configuration names no `output_path`. */
  artifacts: ArtifactPlan | undefined;
  /** When the run started, in milliseconds since the epoch, so files from earlier runs can be told apart. */
  startedAt: number;
}

/** How much older than the run a file it wrote may look, for file systems that keep coarse times. */
const CLOCK_SLACK_MS = 2000;

/** Whether a file is there and was written since `since`. */
function writtenSince(file: string, since: number): boolean {
  try {
    return statSync(file).mtimeMs >= since - CLOCK_SLACK_MS;
  } catch {
    return false;
  }
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

/** Whether a path lies inside a folder, or is the folder. */
function isInside(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Why a file at a candidate's name is not opened, or undefined when it opens.
 *
 * A link opens only when it leads to a regular file inside a workspace folder,
 * since Veridelta 0.42.2 writes through a link at a file's name.
 */
function reasonToSkip(file: string): string | undefined {
  const name = path.basename(file);
  try {
    const entry = lstatSync(file);
    if (entry.isSymbolicLink()) {
      const target = realpathSync(file);
      const folders = (vscode.workspace.workspaceFolders ?? []).filter(
        (folder) => folder.uri.scheme === "file",
      );
      if (!folders.some((folder) => isInside(target, realpathSync(folder.uri.fsPath)))) {
        return `${name} links outside the workspace`;
      }
      return statSync(target).isFile() ? undefined : `${name} is not a file`;
    }
    return entry.isFile() ? undefined : `${name} is not a file`;
  } catch {
    return `${name} cannot be read`;
  }
}

/**
 * Open the discrepancy files a run wrote, and return them.
 *
 * Only files this run wrote open: a kind the summary counts none of, or a
 * file older than the run, is left from an earlier run. CSV, JSON, and
 * NDJSON open as text documents. Parquet and Arrow are shown in the
 * Explorer, with a hint naming the format that opens as text.
 */
export async function openArtifacts(outcome: RunOutcome): Promise<string[]> {
  const plan = outcome.artifacts;
  if (plan === undefined) {
    void showInformation("This configuration sets no output_path, so the run wrote no discrepancy files.");
    return [];
  }
  const { summary } = outcome;
  const files = candidatesFor(plan, summary)
    .map((name) => path.join(plan.folder, name))
    .filter((file) => writtenSince(file, outcome.startedAt));
  if (files.length === 0) {
    const differ = summary.added + summary.removed + summary.changed;
    void showInformation(
      differ === 0
        ? "No rows differ, so the run wrote no discrepancy files."
        : `The run counted ${String(differ)} rows that differ, and wrote no discrepancy files to ${plan.folder} that it could find.`,
    );
    return [];
  }
  if (plan.textual) {
    const opened: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const reason = reasonToSkip(file);
      if (reason !== undefined) {
        skipped.push(reason);
        continue;
      }
      try {
        // vscode.open asks before opening a large file, where showTextDocument fails.
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), {
          preview: false,
          preserveFocus: true,
        });
        opened.push(file);
      } catch {
        skipped.push(`${path.basename(file)} did not open`);
      }
    }
    if (skipped.length > 0) {
      void showWarning(
        `Veridelta did not open every discrepancy file in ${plan.folder}: ${skipped.join("; ")}.`,
      );
    }
    return opened;
  }
  await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(files[0] ?? plan.folder));
  const noun = files.length === 1 ? "file" : "files";
  void showInformation(
    `The run wrote ${String(files.length)} ${plan.format} ${noun} to ${plan.folder}. Set output_format to csv to open them as text.`,
  );
  return files;
}

/** Offer the report, the discrepancy files, and the output, once the verdict is known. */
async function offerOutcome(outcome: RunOutcome, surfaces: Surfaces): Promise<void> {
  const line = verdictLine(outcome.summary);
  const choice = outcome.summary.isMatch
    ? await showInformation(line, OPEN_REPORT, OPEN_FILES, SHOW_OUTPUT)
    : await showWarning(line, OPEN_REPORT, OPEN_FILES, SHOW_OUTPUT);
  if (choice === OPEN_REPORT) {
    try {
      await openReportOf(outcome);
    } catch (error) {
      void explainReport(outcome, error);
    }
  } else if (choice === OPEN_FILES) {
    await openArtifacts(outcome);
  } else if (choice === SHOW_OUTPUT) {
    surfaces.output.show(true);
  }
}

/** Say why the report did not open, and offer the file when it is there but was refused. */
async function explainReport(outcome: RunOutcome, error: unknown): Promise<void> {
  if (error instanceof ReportMissing) {
    void showError(`Veridelta could not show the report: ${error.message}`);
    return;
  }
  const reveal = "Reveal the report file";
  const choice = await showError(
    `Veridelta could not show the report: ${messageOf(error)} It opens only behind its policy, so the file is left as it is.`,
    reveal,
  );
  if (choice === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(outcome.reportFile));
  }
}

async function showFailure(message: string, surfaces: Surfaces): Promise<void> {
  const choice = await showError(message, SHOW_OUTPUT);
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
    void showWarning("Veridelta runs a configuration file on disk. Save the document first.");
    return undefined;
  }
  const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
  if (open?.isDirty === true && !(await open.save())) {
    void showWarning("Veridelta runs the saved file, and the save did not finish.");
    return undefined;
  }
  const configFile = uri.fsPath;
  const folder = path.dirname(configFile);
  const name = path.basename(configFile);
  const reportFile = await reportPath(context, configFile);
  const args = ["run", "-c", configFile, "--json", "--html", reportFile, ...maxRowsArguments()];
  const startedAt = Date.now();
  let finished: Finished;
  try {
    finished = await withProgress(
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
      void showInformation(`Veridelta: the run of ${name} was cancelled.`);
    } else if (error instanceof CommandNotFound) {
      void offerSettings(`${error.message} Set veridelta.command to the words that run it.`);
    } else {
      void showError(`Veridelta could not start: ${messageOf(error)}`);
    }
    return undefined;
  }
  logStderr(surfaces.output, finished.stderr);
  const parsed = parseRunOutput(finished.stdout, finished.code);
  if (parsed.kind === "unparsable") {
    if (finished.stderr.trim() === "") {
      logStderr(surfaces.output, finished.stdout);
    }
    const detail = finished.stderr.trim() || finished.stdout.trim() || `exit code ${String(finished.code)}`;
    void showFailure(`Veridelta gave no summary to read: ${detail}`, surfaces);
    return undefined;
  }
  if (parsed.kind === "error") {
    surfaces.output.appendLine(`${parsed.error.type}: ${parsed.error.message}`);
    void showFailure(`Veridelta: ${parsed.error.type}: ${parsed.error.message}`, surfaces);
    return undefined;
  }
  const configText = await readFile(configFile, "utf8");
  const outcome: RunOutcome = {
    configFile,
    summary: parsed.summary,
    reportFile,
    artifacts: artifactPlan(configText, folder),
    startedAt,
  };
  offerOutcome(outcome, surfaces).catch((error: unknown) => {
    void showFailure(`Veridelta could not finish that: ${messageOf(error)}`, surfaces);
  });
  return outcome;
}
