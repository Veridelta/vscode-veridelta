// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Register `veridelta mcp` with agent mode, one `--root` per workspace folder, with the settings as flags.
 */

import * as vscode from "vscode";

import { cliVersion, configuredCommand } from "./cli";
import { DEFAULT_MAX_ROWS, serverCommand, type McpSettings } from "./mcpArgs";
import { parseVersion } from "./version";

/** The id `package.json` contributes under `mcpServerDefinitionProviders`. */
export const PROVIDER_ID = "veridelta.mcp";

const LABEL = "Veridelta";

function readSettings(): McpSettings {
  const configuration = vscode.workspace.getConfiguration("veridelta.mcp");
  const allowRowValues: unknown = configuration.get("allowRowValues");
  const allowQueries: unknown = configuration.get("allowQueries");
  const maxRows: unknown = configuration.get("maxRows");
  return {
    allowRowValues: allowRowValues === true,
    allowQueries: allowQueries === true,
    maxRows:
      typeof maxRows === "number" && Number.isInteger(maxRows) && maxRows >= 1 ? maxRows : DEFAULT_MAX_ROWS,
  };
}

/** The server for the open workspace, or undefined when no folder on disk is open. */
export function currentDefinition(): vscode.McpStdioServerDefinition | undefined {
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
  const [first] = folders;
  if (first === undefined) {
    return undefined;
  }
  const { program, args } = serverCommand(
    configuredCommand(),
    folders.map((folder) => folder.uri.fsPath),
    readSettings(),
  );
  const definition = new vscode.McpStdioServerDefinition(LABEL, program, args);
  definition.cwd = first.uri;
  return definition;
}

/** What agent mode asks for its servers: one Veridelta server, restarted when the folders or the settings change. */
export class VerideltaMcpProvider
  implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();

  readonly onDidChangeMcpServerDefinitions = this.changed.event;

  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.changed.fire();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("veridelta")) {
          this.changed.fire();
        }
      }),
    ];
  }

  provideMcpServerDefinitions(): vscode.McpStdioServerDefinition[] {
    const definition = currentDefinition();
    return definition === undefined ? [] : [definition];
  }

  /** Fill in the installed Veridelta's version, which agent mode shows beside the server. */
  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
  ): Promise<vscode.McpStdioServerDefinition> {
    const folder = server.cwd?.fsPath;
    if (folder !== undefined) {
      const text = await cliVersion(folder);
      const version = text === undefined ? undefined : parseVersion(text);
      if (version !== undefined) {
        server.version = version.join(".");
      }
    }
    return server;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changed.dispose();
  }
}

/** Register the provider for the extension's lifetime and return it, so tests can ask it directly. */
export function registerMcpProvider(context: vscode.ExtensionContext): VerideltaMcpProvider {
  const provider = new VerideltaMcpProvider();
  context.subscriptions.push(provider, vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
  return provider;
}
