// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The HTML report in an editor tab, behind a Content Security Policy.
 */

import { readFile } from "node:fs/promises";

import * as vscode from "vscode";

import { makeNonce, withCsp } from "./csp";

/** The report a run wrote is gone, so there is nothing to show. */
export class ReportMissing extends Error {
  constructor(readonly file: string) {
    super("The report is no longer there. Run the comparison again to write it.");
    this.name = "ReportMissing";
  }
}

/**
 * Open the report a run wrote, beside the current editor, and return its panel.
 *
 * The report is read and given its policy before any tab opens, so a report
 * that is gone or that the policy refuses leaves no empty tab behind.
 */
export async function openReport(file: string, title: string): Promise<vscode.WebviewPanel> {
  let html: string;
  try {
    html = await readFile(file, "utf8");
  } catch {
    throw new ReportMissing(file);
  }
  const page = withCsp(html, makeNonce());
  const panel = vscode.window.createWebviewPanel("veridelta.report", title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [],
    retainContextWhenHidden: true,
  });
  panel.webview.html = page;
  return panel;
}
