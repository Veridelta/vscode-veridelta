// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the commands share of the editor: where problems and output go, and the notifications they raise.
 *
 * Every notification and progress title goes through this module. A message
 * can carry text from a configuration, from the data, or from Veridelta's
 * errors, and VS Code turns `[label](target)` in a message into a link that
 * runs a command on one click. `inert` breaks that pattern before anything
 * is shown, and the lint configuration keeps the other modules from calling
 * the notification API themselves.
 */

import * as vscode from "vscode";

import { inert } from "./inert";

/** Where the commands' problems and output go. */
export interface Surfaces {
  diagnostics: vscode.DiagnosticCollection;
  output: vscode.OutputChannel;
}

/** How many shown messages `recentNotifications` keeps. */
const KEPT = 20;

const recent: string[] = [];

/** Make a message safe to show, and keep it for `recentNotifications`. */
function shown(message: string): string {
  const safe = inert(message);
  recent.push(safe);
  if (recent.length > KEPT) {
    recent.shift();
  }
  return safe;
}

/** The messages shown most recently, oldest first, as the user saw them. */
export function recentNotifications(): readonly string[] {
  return recent;
}

export function showInformation<T extends string>(message: string, ...items: T[]): Thenable<T | undefined> {
  return vscode.window.showInformationMessage(shown(message), ...items);
}

export function showWarning<T extends string>(message: string, ...items: T[]): Thenable<T | undefined> {
  return vscode.window.showWarningMessage(shown(message), ...items);
}

export function showError<T extends string>(message: string, ...items: T[]): Thenable<T | undefined> {
  return vscode.window.showErrorMessage(shown(message), ...items);
}

/** Run a task under a progress indicator whose title is shown as plain text. */
export function withProgress<R>(
  options: vscode.ProgressOptions,
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ) => Thenable<R>,
): Thenable<R> {
  const title = options.title === undefined ? undefined : shown(options.title);
  return vscode.window.withProgress(title === undefined ? options : { ...options, title }, task);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Offer the settings editor when the command is not on PATH. */
export async function offerSettings(message: string): Promise<void> {
  const open = "Open settings";
  const choice = await showError(message, open);
  if (choice === open) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "veridelta.command");
  }
}

/**
 * Append what the command printed to stdout when it cannot be read and stderr is empty.
 *
 * A notification shows that text with its links broken, so the output
 * channel keeps it as it was printed.
 */
export function logUnreadable(output: vscode.OutputChannel, stdout: string, stderr: string): void {
  if (stderr.trim() === "") {
    logStderr(output, stdout);
  }
}

/** Append every line the command wrote to stderr to the output channel. */
export function logStderr(output: vscode.OutputChannel, stderr: string): void {
  for (const line of stderr.split(/\r?\n/)) {
    if (line.length > 0) {
      output.appendLine(line);
    }
  }
}
