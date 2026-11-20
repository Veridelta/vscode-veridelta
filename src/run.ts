// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The run command: run `veridelta run --json --html` on a configuration, then offer the report and the files.
 */

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";

import * as vscode from "vscode";

import {
  candidatesFor,
  isInside,
  planArtifacts,
  writtenNow,
  writtenSince,
  type ArtifactPlan,
  type FileStamp,
  type StampNow,
} from "./artifacts";
import { CommandNotFound, RunCancelled, runVeridelta, type Finished } from "./cli";
import {
  logStderr,
  logUnreadable,
  messageOf,
  offerSettings,
  showError,
  showInformation,
  showWarning,
  withProgress,
  type Surfaces,
} from "./notify";
import { KEEP_PER_CONFIGURATION, reportsToRemove } from "./reports";
import { openReport, ReportMissing } from "./reportView";
import { parseRunOutput, verdictLine, type RunSummary } from "./summary";

/** What a run gave: its summary, the report it wrote, and where its discrepancy files went. */
export interface RunOutcome {
  configFile: string;
  summary: RunSummary;
  reportFile: string;
  /** Where the discrepancy files went, or undefined when the configuration names no `output_path`. */
  artifacts: ArtifactPlan | undefined;
  /** False when the extension could not read the configuration's output settings, which Veridelta read. */
  artifactsReadable: boolean;
  /** When the run started, in milliseconds since the epoch, so files from earlier runs can be told apart. */
  startedAt: number;
  /** The discrepancy files this run wrote, by path, as they were when it finished. */
  written: Record<string, FileStamp>;
}

/** When a file was written and its size, or undefined when it is not there. */
function stampOf(file: string): StampNow {
  try {
    const { mtimeMs, size } = statSync(file);
    return { mtimeMs, size };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "gone" : "unreadable";
  }
}

/**
 * The discrepancy files a run wrote, as they are when it finishes.
 *
 * A file of a kind the summary counts none of, or one older than the run, is
 * left from an earlier run and is not this run's.
 */
function writtenBy(
  plan: ArtifactPlan | undefined,
  counts: RunSummary,
  startedAt: number,
): Record<string, FileStamp> {
  const written: Record<string, FileStamp> = {};
  if (plan === undefined) {
    return written;
  }
  for (const name of candidatesFor(plan, counts)) {
    const file = path.join(plan.folder, name);
    const stamp = stampOf(file);
    if (typeof stamp === "object" && writtenSince(stamp, startedAt)) {
      written[file] = stamp;
    }
  }
  return written;
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

/**
 * Remove this configuration's reports past the newest `keep`, and any report older than a week.
 *
 * Runs of one configuration can overlap, and another prune can remove a file
 * first, so a file that is gone by the time it is read is skipped.
 */
async function pruneReports(folder: string, prefix: string, keep: number): Promise<void> {
  const names = await readdir(folder);
  const entries = (
    await Promise.all(
      names.map(async (name) => {
        try {
          return { name, mtimeMs: (await stat(path.join(folder, name))).mtimeMs };
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((entry) => entry !== undefined);
  await Promise.all(
    reportsToRemove(entries, prefix, Date.now(), keep).map((name) =>
      rm(path.join(folder, name), { force: true }),
    ),
  );
}

/** Hold the configuration to its newest reports once a run is done, since runs of it can overlap. */
async function pruneAfterRun(reportFile: string): Promise<void> {
  try {
    await pruneReports(path.dirname(reportFile), reportPrefix(reportFile), KEEP_PER_CONFIGURATION);
  } catch {
    // A report that cannot be removed now is removed after a later run.
  }
}

/** The name prefix every report of one configuration shares. */
function reportPrefix(reportFile: string): string {
  return path.basename(reportFile).replace(/[^-]+\.html$/, "");
}

/**
 * Where the report goes: the extension's storage, so the workspace stays clean.
 *
 * Each run gets its own file, so an earlier run's notification still opens
 * that run's report. Reports past the newest few of the configuration are
 * removed, since each holds rows from the data.
 */
async function reportPath(context: vscode.ExtensionContext, configFile: string): Promise<string> {
  const folder = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, "reports");
  await vscode.workspace.fs.createDirectory(folder);
  const hash = createHash("sha256").update(configFile).digest("hex").slice(0, 8);
  const prefix = `${path.parse(configFile).name}-${hash}-`;
  try {
    // Room for the report this run writes.
    await pruneReports(folder.fsPath, prefix, KEEP_PER_CONFIGURATION - 1);
  } catch {
    // A report that cannot be removed now is removed after a later run.
  }
  const stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  return vscode.Uri.joinPath(folder, `${prefix}${stamp}.html`).fsPath;
}

/** Open the report a run wrote, titled by its configuration. */
export function openReportOf(outcome: RunOutcome): Promise<vscode.WebviewPanel> {
  return openReport(outcome.reportFile, `Veridelta report: ${path.basename(outcome.configFile)}`);
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
 * Only the files this run wrote open, and only while they are as it left
 * them: a later run of the same configuration rewrites them, and they are
 * then that run's. CSV, JSON, and
 * NDJSON open as text documents. Parquet and Arrow are shown in the
 * Explorer, with a hint naming the format that opens as text.
 */
export async function openArtifacts(outcome: RunOutcome): Promise<string[]> {
  const plan = outcome.artifacts;
  if (plan === undefined) {
    void showInformation(
      outcome.artifactsReadable
        ? "This configuration sets no output_path, so the run wrote no discrepancy files."
        : "The extension could not read output_path from this configuration, so it cannot find the discrepancy files. Open the output_path folder in the Explorer.",
    );
    return [];
  }
  const { summary } = outcome;
  const { current: files, notes } = writtenNow(outcome.written, stampOf);
  if (notes.length > 0 && files.length === 0) {
    void showInformation(
      `The discrepancy files this run wrote in ${plan.folder} are gone or changed since it finished, so none of them is this run's now: ${notes.join("; ")}. A later run of the configuration rewrites them.`,
    );
    return [];
  }
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
    const skipped = [...notes];
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
  const count = Object.keys(outcome.written).length;
  const noun = count === 1 ? "file" : "files";
  const changes = notes.length > 0 ? ` ${notes.join("; ")}.` : "";
  void showInformation(
    `The run wrote ${String(count)} ${plan.format} ${noun} to ${plan.folder}.${changes} Set output_format to csv to open them as text.`,
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
    await pruneAfterRun(reportFile);
    if (error instanceof RunCancelled) {
      void showInformation(`Veridelta: the run of ${name} was cancelled.`);
    } else if (error instanceof CommandNotFound) {
      void offerSettings(`${error.message} Set veridelta.command to the words that run it.`);
    } else {
      void showError(`Veridelta could not start: ${messageOf(error)}`);
    }
    return undefined;
  }
  await pruneAfterRun(reportFile);
  logStderr(surfaces.output, finished.stderr);
  const parsed = parseRunOutput(finished.stdout, finished.code);
  if (parsed.kind === "unparsable") {
    logUnreadable(surfaces.output, finished.stdout);
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
  const read = planArtifacts(configText, folder);
  const written = writtenBy(read.plan, parsed.summary, startedAt);
  const outcome: RunOutcome = {
    configFile,
    summary: parsed.summary,
    reportFile,
    artifacts: read.plan,
    artifactsReadable: read.readable,
    startedAt,
    written,
  };
  offerOutcome(outcome, surfaces).catch((error: unknown) => {
    void showFailure(`Veridelta could not finish that: ${messageOf(error)}`, surfaces);
  });
  return outcome;
}
