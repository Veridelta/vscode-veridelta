// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Register `veridelta mcp` with agent mode, one `--root` per workspace folder, with the settings as flags.
 */

import * as vscode from "vscode";

import { cliVersion, configuredCommand, runVeridelta } from "./cli";
import {
  DEFAULT_MAX_ROWS,
  hasAllowHost,
  serverCommand,
  takesAllowHost,
  withoutAllowHost,
  type McpSettings,
} from "./mcpArgs";
import { parseVersion } from "./version";

/** The id `package.json` contributes under `mcpServerDefinitionProviders`. */
export const PROVIDER_ID = "veridelta.mcp";

const LABEL = "Veridelta";

/** Whether this session has already said that the installed Veridelta does not take `--allow-host`. */
let warnedAboutAllowHost = false;

function readSettings(): McpSettings {
  const configuration = vscode.workspace.getConfiguration("veridelta.mcp");
  const allowRowValues: unknown = configuration.get("allowRowValues");
  const allowQueries: unknown = configuration.get("allowQueries");
  const maxRows: unknown = configuration.get("maxRows");
  const allowHosts: unknown = configuration.get("allowHosts");
  return {
    allowRowValues: allowRowValues === true,
    allowQueries: allowQueries === true,
    maxRows:
      typeof maxRows === "number" && Number.isInteger(maxRows) && maxRows >= 1 ? maxRows : DEFAULT_MAX_ROWS,
    allowHosts: Array.isArray(allowHosts)
      ? allowHosts.filter((host): host is string => typeof host === "string" && host.length > 0)
      : [],
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

/** Whether the installed Veridelta's `mcp` command has no `--allow-host`; false when its help does not run. */
async function lacksAllowHost(folder: string): Promise<boolean> {
  try {
    const finished = await runVeridelta(["mcp", "--help"], folder);
    return finished.code === 0 && !takesAllowHost(finished.stdout);
  } catch {
    return false;
  }
}

/** Say once that the hosts setting does not apply to the installed Veridelta. */
function warnAboutAllowHost(installed: string): void {
  if (warnedAboutAllowHost) {
    return;
  }
  warnedAboutAllowHost = true;
  void vscode.window.showWarningMessage(
    `${installed} has no --allow-host, so veridelta.mcp.allowHosts does not apply, and the agent's tools connect to any host a configuration names. A later Veridelta holds them to the hosts the setting lists.`,
  );
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

  /**
   * Fill in the installed Veridelta's version, which agent mode shows beside the server.
   *
   * A Veridelta that does not take `--allow-host` would refuse to start with it,
   * so the flags are left out for one, and a notification says so once.
   */
  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
  ): Promise<vscode.McpStdioServerDefinition> {
    const folder = server.cwd?.fsPath;
    if (folder === undefined) {
      return server;
    }
    const text = await cliVersion(folder);
    const version = text === undefined ? undefined : parseVersion(text);
    if (version !== undefined) {
      server.version = version.join(".");
    }
    if (hasAllowHost(server.args) && (await lacksAllowHost(folder))) {
      server.args = withoutAllowHost(server.args);
      warnAboutAllowHost(
        version === undefined ? "The installed Veridelta" : `Veridelta ${version.join(".")}`,
      );
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
