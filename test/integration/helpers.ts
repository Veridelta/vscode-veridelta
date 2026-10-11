// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What every integration test needs: the fixture workspace and the activated extension.
 */

import * as assert from "node:assert/strict";

import * as vscode from "vscode";

import type { Api } from "../../src/extension";

/** The fixture workspace's folder. */
export function workspaceFolder(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the fixture workspace is open");
  return folder.uri;
}

/** A file in the fixture workspace. */
export function fixture(name: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceFolder(), name);
}

/** Open a file in the fixture workspace as a document. */
export async function openFixture(name: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(fixture(name));
}

/** The extension's test API, activating it first. */
export async function extension(): Promise<Api> {
  const found = vscode.extensions.getExtension<Api>("veridelta.vscode-veridelta");
  assert.ok(found, "the extension is in the test host");
  return found.activate();
}
