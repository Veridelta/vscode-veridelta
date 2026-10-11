// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the commands share of the editor: where problems and output go, and the notifications they raise.
 */

import * as vscode from "vscode";

/** Where the commands' problems and output go. */
export interface Surfaces {
  diagnostics: vscode.DiagnosticCollection;
  output: vscode.OutputChannel;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Offer the settings editor when the command is not on PATH. */
export async function offerSettings(message: string): Promise<void> {
  const open = "Open settings";
  const choice = await vscode.window.showErrorMessage(message, open);
  if (choice === open) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "veridelta.command");
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
