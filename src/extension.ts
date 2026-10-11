// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The Veridelta extension: a command that validates the open configuration into the Problems panel.
 *
 * `activate` returns the pieces the integration tests drive, so a test runs the
 * same code the command does without the Command Palette.
 */

import * as vscode from "vscode";

import { validateDocument, type Surfaces } from "./validate";

/** What `activate` hands back, for tests. */
export interface Api {
  validateDocument(document: vscode.TextDocument): Promise<vscode.Diagnostic[]>;
  diagnostics: vscode.DiagnosticCollection;
}

export function activate(context: vscode.ExtensionContext): Api {
  const surfaces: Surfaces = {
    diagnostics: vscode.languages.createDiagnosticCollection("veridelta"),
    output: vscode.window.createOutputChannel("Veridelta"),
  };
  context.subscriptions.push(surfaces.diagnostics, surfaces.output);

  context.subscriptions.push(
    vscode.commands.registerCommand("veridelta.validate", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        void vscode.window.showInformationMessage(
          "Open a Veridelta configuration file, then run the command.",
        );
        return;
      }
      await validateDocument(editor.document, surfaces);
    }),
  );

  // A problem goes when its file closes, as the panel's other sources behave.
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      surfaces.diagnostics.delete(document.uri);
    }),
  );

  return {
    validateDocument: (document) => validateDocument(document, surfaces),
    diagnostics: surfaces.diagnostics,
  };
}

export function deactivate(): void {
  // Every disposable sits in the context's subscriptions.
}
