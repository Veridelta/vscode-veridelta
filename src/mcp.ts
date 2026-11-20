// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Register `veridelta mcp` with agent mode, one `--root` per workspace folder, with the settings as flags.
 */

import * as vscode from "vscode";

import { cliVersion, configuredCommand, runVeridelta } from "./cli";
import {
  hasAllowHost,
  maxRowsOf,
  serverCommand,
  takesAllowHost,
  withoutAllowHost,
  type McpSettings,
} from "./mcpArgs";
import { showWarning } from "./notify";
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
    maxRows: maxRowsOf(maxRows),
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
  void showWarning(
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
   * Return the server to start: built from the settings and folders as they are now, with the version.
   *
   * VS Code passes the definition it kept from the last provide, which can be
   * older than a settings change made since. That object is left as it is,
   * and a new one is returned, so a revoked flag never starts and a dropped
   * flag is not dropped for good. A Veridelta that does not take
   * `--allow-host` would refuse to start with it, so the hosts are left out
   * for one, and a notification says so once.
   */
  async resolveMcpServerDefinition(
    kept: vscode.McpStdioServerDefinition,
  ): Promise<vscode.McpStdioServerDefinition | undefined> {
    const before = currentDefinition();
    const folder = before?.cwd?.fsPath;
    if (before === undefined || folder === undefined) {
      return undefined;
    }
    const text = await cliVersion(folder);
    const version = text === undefined ? undefined : parseVersion(text);
    const lacks = hasAllowHost(before.args) && (await lacksAllowHost(folder));
    // The settings may have changed while the probes ran, so read them again.
    const definition = currentDefinition();
    if (definition === undefined) {
      return undefined;
    }
    const shown = version === undefined ? kept.version : version.join(".");
    if (shown !== undefined) {
      definition.version = shown;
    }
    if (lacks) {
      definition.args = withoutAllowHost(definition.args);
      warnAboutAllowHost(
        version === undefined ? "The installed Veridelta" : `Veridelta ${version.join(".")}`,
      );
    }
    return definition;
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
