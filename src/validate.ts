// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The validate command: run `veridelta validate --json` on a document and fill the Problems panel.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import { cliVersion, CommandNotFound, RunCancelled, RunTimedOut, runVeridelta, type Finished } from "./cli";
import { rangeFor } from "./locate";
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
import { parseOutput, problemsOf, type Problem } from "./report";
import { isAtLeast, LOCATIONS_VERSION, MINIMUM_VERSION, parseVersion } from "./version";

const SOURCE = "veridelta";

/** How long one validate may run. A first `uv run` can install the project, so it is generous. */
const VALIDATE_TIMEOUT_MS = 5 * 60 * 1000;

/** The validate running for each file, so a newer one ends the older and only the newest sets problems. */
const running = new Map<string, AbortController>();

/** Whether this session has already explained why problems sit on the first line. */
let hintedAboutLocations = false;

function toDiagnostic(text: string, problem: Problem): vscode.Diagnostic {
  const range = rangeFor(text, problem.location);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character),
    problem.message,
    problem.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = SOURCE;
  return diagnostic;
}

/** Say once why every problem sits on the first line: the installed Veridelta predates locations. */
async function hintAboutLocations(folder: string): Promise<void> {
  if (hintedAboutLocations) {
    return;
  }
  hintedAboutLocations = true;
  const text = await cliVersion(folder);
  const version = text === undefined ? undefined : parseVersion(text);
  const installed = version === undefined ? "The installed Veridelta" : `Veridelta ${version.join(".")}`;
  void showInformation(
    `${installed} reports each problem on the first line. Veridelta ${LOCATIONS_VERSION} or later places it on its line.`,
  );
}

/** Explain output this extension cannot read, naming the version floor when that is the cause. */
async function explainUnreadable(detail: string, folder: string): Promise<void> {
  const text = await cliVersion(folder);
  const version = text === undefined ? undefined : parseVersion(text);
  if (version !== undefined && !isAtLeast(text ?? "", MINIMUM_VERSION)) {
    void showError(
      `Veridelta ${version.join(".")} is older than ${MINIMUM_VERSION}, the oldest this extension reads. Upgrade Veridelta.`,
    );
    return;
  }
  void showError(`Veridelta gave no report to read: ${detail}`);
}

/**
 * Validate the file behind a document and show its findings in the Problems panel.
 *
 * Veridelta reads the file from disk, so a document with unsaved changes is
 * saved first. A progress notification can cancel the run, and a newer
 * validate of the same file ends an older one, so only the newest sets the
 * problems. When a validate gives no result, the file's problems are cleared. The command runs in the file's folder, so relative paths in
 * the configuration resolve as they do on the command line, and `uv run`
 * finds the project. Every line the command writes to stderr goes to the
 * Veridelta output channel, verdict included. Notifications are not awaited,
 * so the promise settles when the diagnostics are set.
 *
 * Returns the diagnostics shown, so a test can read them without the panel.
 */
export async function validateDocument(
  document: vscode.TextDocument,
  surfaces: Surfaces,
): Promise<vscode.Diagnostic[]> {
  if (document.uri.scheme !== "file") {
    void showWarning("Veridelta validates a file on disk. Save the document first.");
    return [];
  }
  if (document.isDirty && !(await document.save())) {
    void showWarning("Veridelta validates the saved file, and the save did not finish.");
    return [];
  }
  const file = document.uri.fsPath;
  const folder = path.dirname(file);
  const key = document.uri.toString();
  running.get(key)?.abort();
  const controller = new AbortController();
  running.set(key, controller);
  const savedVersion = document.version;
  let finished: Finished;
  try {
    finished = await withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Veridelta: validating ${path.basename(file)}`,
        cancellable: true,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => {
          controller.abort();
        });
        return runVeridelta(["validate", "-c", file, "--json"], folder, {
          signal: controller.signal,
          timeoutMs: VALIDATE_TIMEOUT_MS,
        });
      },
    );
  } catch (error) {
    if (running.get(key) !== controller) {
      // A newer validate of this file took over, and it sets the problems.
      return [];
    }
    running.delete(key);
    // Problems from an earlier validate would describe a file this one never read.
    surfaces.diagnostics.delete(document.uri);
    if (error instanceof RunCancelled) {
      void showInformation(`Veridelta: the validate of ${path.basename(file)} was cancelled.`);
    } else if (error instanceof CommandNotFound) {
      void offerSettings(`${error.message} Set veridelta.command to the words that run it.`);
    } else if (error instanceof RunTimedOut) {
      void showError(error.message);
    } else {
      void showError(`Veridelta could not start: ${messageOf(error)}`);
    }
    return [];
  }
  if (running.get(key) !== controller) {
    return [];
  }
  running.delete(key);
  logStderr(surfaces.output, finished.stderr);
  const parsed = parseOutput(finished.stdout, finished.code);
  if (parsed.kind === "unparsable") {
    const detail = finished.stderr.trim() || finished.stdout.trim() || `exit code ${String(finished.code)}`;
    void explainUnreadable(detail, folder);
    surfaces.diagnostics.delete(document.uri);
    return [];
  }
  if (parsed.kind === "report" && parsed.report.findings === undefined) {
    void hintAboutLocations(folder);
  }
  const text = document.getText();
  // An edit made while Veridelta ran can move lines, so a problem placed by its line number is
  // dropped then. A problem placed by its path still finds its setting in the edited text.
  const edited = document.version !== savedVersion;
  const diagnostics = problemsOf(parsed)
    .filter((problem) => !edited || problem.location?.line === undefined)
    .map((problem) => toDiagnostic(text, problem));
  surfaces.diagnostics.set(document.uri, diagnostics);
  return diagnostics;
}
