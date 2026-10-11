// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which configuration a command runs: the active YAML editor, else a pick among the workspace's files.
 */

import * as vscode from "vscode";

const CONFIG_GLOB = "**/veridelta*.yaml";
const EXCLUDED = "**/{node_modules,.venv,venv,site,.git}/**";
const MOST = 50;

/** Return the configuration to run, or undefined when there is none or the pick was dismissed. */
export async function pickConfiguration(): Promise<vscode.Uri | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (active?.uri.scheme === "file" && /\.ya?ml$/i.test(active.uri.fsPath)) {
    return active.uri;
  }
  const found = await vscode.workspace.findFiles(CONFIG_GLOB, EXCLUDED, MOST);
  if (found.length === 0) {
    void vscode.window.showInformationMessage("Open a Veridelta configuration file, then run the command.");
    return undefined;
  }
  if (found.length === 1) {
    return found[0];
  }
  const picked = await vscode.window.showQuickPick(
    found.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: "Which configuration should Veridelta run?" },
  );
  return picked?.uri;
}
