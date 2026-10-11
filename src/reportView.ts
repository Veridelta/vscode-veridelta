// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The HTML report in an editor tab, behind a Content Security Policy.
 */

import { readFile } from "node:fs/promises";

import * as vscode from "vscode";

import { makeNonce, withCsp } from "./csp";

/** Open the report a run wrote, beside the current editor, and return its panel. */
export async function openReport(file: string, title: string): Promise<vscode.WebviewPanel> {
  const html = await readFile(file, "utf8");
  const panel = vscode.window.createWebviewPanel("veridelta.report", title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [],
    retainContextWhenHidden: true,
  });
  panel.webview.html = withCsp(html, makeNonce());
  return panel;
}
