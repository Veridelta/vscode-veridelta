// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The validate command: run `veridelta validate --json` on a document and fill the Problems panel.
 */

import * as path from "node:path";

import * as vscode from "vscode";

import { cliVersion, CommandNotFound, runVeridelta, type Finished } from "./cli";
import { rangeFor } from "./locate";
import { logStderr, messageOf, offerSettings, type Surfaces } from "./notify";
import { parseOutput, problemsOf, type Problem } from "./report";
import { isAtLeast, LOCATIONS_VERSION, MINIMUM_VERSION, parseVersion } from "./version";

const SOURCE = "veridelta";

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
  void vscode.window.showInformationMessage(
    `${installed} reports each problem on the first line. Veridelta ${LOCATIONS_VERSION} or later places it on its line.`,
  );
}

/** Explain output this extension cannot read, naming the version floor when that is the cause. */
async function explainUnreadable(detail: string, folder: string): Promise<void> {
  const text = await cliVersion(folder);
  const version = text === undefined ? undefined : parseVersion(text);
  if (version !== undefined && !isAtLeast(text ?? "", MINIMUM_VERSION)) {
    void vscode.window.showErrorMessage(
      `Veridelta ${version.join(".")} is older than ${MINIMUM_VERSION}, the oldest this extension reads. Upgrade Veridelta.`,
    );
    return;
  }
  void vscode.window.showErrorMessage(`Veridelta gave no report to read: ${detail}`);
}

/**
 * Validate the file behind a document and show its findings in the Problems panel.
 *
 * Veridelta reads the file from disk, so a document with unsaved changes is
 * saved first. The command runs in the file's folder, so relative paths in
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
    void vscode.window.showWarningMessage("Veridelta validates a file on disk. Save the document first.");
    return [];
  }
  if (document.isDirty && !(await document.save())) {
    void vscode.window.showWarningMessage("Veridelta validates the saved file, and the save did not finish.");
    return [];
  }
  const file = document.uri.fsPath;
  const folder = path.dirname(file);
  let finished: Finished;
  try {
    finished = await runVeridelta(["validate", "-c", file, "--json"], folder);
  } catch (error) {
    if (error instanceof CommandNotFound) {
      void offerSettings(`${error.message} Set veridelta.command to the words that run it.`);
    } else {
      void vscode.window.showErrorMessage(`Veridelta could not start: ${messageOf(error)}`);
    }
    return [];
  }
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
  const diagnostics = problemsOf(parsed).map((problem) => toDiagnostic(text, problem));
  surfaces.diagnostics.set(document.uri, diagnostics);
  return diagnostics;
}
