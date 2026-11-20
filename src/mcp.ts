// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Register `veridelta mcp` with agent mode, one `--root` per workspace folder, with the settings as flags.
 */

import { statSync } from "node:fs";

import * as vscode from "vscode";

import { cliVersion, configuredCommand, runVeridelta } from "./cli";
import {
  maxRowsOf,
  rootFolders,
  serverCommand,
  serverEnv,
  splitHosts,
  takesAllowHost,
  type McpSettings,
} from "./mcpArgs";
import { showWarning } from "./notify";
import { parseVersion } from "./version";

/** The id `package.json` contributes under `mcpServerDefinitionProviders`. */
export const PROVIDER_ID = "veridelta.mcp";

const LABEL = "Veridelta";

/** How long a probe of the installed Veridelta may take before the server starts without its answer. */
const PROBE_TIMEOUT_MS = 15_000;

/** Whether the installed Veridelta takes `--allow-host`, as far as a probe of its help could tell. */
type HostSupport = "takes" | "lacks" | "unknown";

/** Whether this session has already said what the installed Veridelta does not hold. */
let warnedAboutOlder = false;

/** The allowHosts entries this session has already named as left out. */
let namedDropped = "";

/** Say once which allowHosts entries are left out, since Veridelta would refuse to start with them. */
function warnAboutDropped(dropped: readonly string[]): void {
  const names = dropped.map((host) => `'${host}'`).join(", ");
  if (dropped.length === 0 || names === namedDropped) {
    return;
  }
  namedDropped = names;
  void showWarning(
    `veridelta.mcp.allowHosts names ${names}, which Veridelta does not take, so the agent's server starts without it. Write each host in lowercase, with no scheme or port.`,
  );
}

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
    allowHosts: hostsOf(allowHosts),
  };
}

/** The hosts Veridelta takes, from the setting's value; the others are named once and left out. */
function hostsOf(value: unknown): string[] {
  const hosts = Array.isArray(value) ? value.filter((host): host is string => typeof host === "string") : [];
  const { kept, dropped } = splitHosts(hosts);
  warnAboutDropped(dropped);
  return kept;
}

/** Whether a path is a folder on disk now. */
function isFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The server for the open workspace, or undefined when no folder on disk is there.
 *
 * @param withHosts Whether to pass the hosts the settings allow, which only a
 *   Veridelta known to take `--allow-host` gets, since another refuses to start.
 */
export function currentDefinition(withHosts: boolean): vscode.McpStdioServerDefinition | undefined {
  const folders = rootFolders(
    (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === "file")
      .map((folder) => folder.uri.fsPath),
    isFolder,
  );
  const [first] = folders;
  if (first === undefined) {
    return undefined;
  }
  const settings = readSettings();
  const { program, args } = serverCommand(
    configuredCommand(),
    folders,
    withHosts ? settings : { ...settings, allowHosts: [] },
  );
  const env = serverEnv(vscode.workspace.getConfiguration("veridelta.mcp").get("env"));
  const definition = new vscode.McpStdioServerDefinition(LABEL, program, args, env);
  definition.cwd = vscode.Uri.file(first);
  return definition;
}

/** Whether the settings name any host the agent may connect to. */
function wantsHosts(): boolean {
  return readSettings().allowHosts.length > 0;
}

/** Ask the installed Veridelta's `mcp --help` whether it takes `--allow-host`. */
async function probeHostSupport(folder: string): Promise<HostSupport> {
  try {
    const finished = await runVeridelta(["mcp", "--help"], folder, { timeoutMs: PROBE_TIMEOUT_MS });
    if (finished.code !== 0) {
      return "unknown";
    }
    return takesAllowHost(finished.stdout) ? "takes" : "lacks";
  } catch {
    return "unknown";
  }
}

/**
 * Say once what the installed Veridelta does not hold.
 *
 * A Veridelta with no `--allow-host`, such as 0.42.2, also predates the
 * change that keeps database errors, which can quote values, from the agent.
 */
function warnAboutOlder(installed: string, support: HostSupport, hostsSet: boolean): void {
  if (warnedAboutOlder || support === "takes" || (support === "unknown" && !hostsSet)) {
    return;
  }
  warnedAboutOlder = true;
  if (support === "unknown") {
    void showWarning(
      "The extension could not tell whether the installed Veridelta takes --allow-host, so the agent's server starts without the hosts veridelta.mcp.allowHosts lists.",
    );
    return;
  }
  const hosts = hostsSet ? " veridelta.mcp.allowHosts does not apply to it, so its hosts are left out." : "";
  void showWarning(
    `${installed} has no --allow-host. With it, the agent's tools can connect to any host a configuration names, and a tool's error can quote a value from the data with veridelta.mcp.allowRowValues off.${hosts} A Veridelta release after 0.42.2 holds the tools to the hosts that setting lists and keeps database errors that quote values from the agent.`,
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

  /** What each `veridelta.command` this session probed answered about `--allow-host`. */
  private readonly support = new Map<string, HostSupport>();

  /** The probes still running, one per command. */
  private readonly probing = new Map<string, Promise<HostSupport>>();

  /** The answer for the configured command, probing once per session in `folder`. */
  private supportFor(folder: string): Promise<HostSupport> {
    const key = JSON.stringify(configuredCommand());
    const known = this.support.get(key);
    if (known !== undefined) {
      return Promise.resolve(known);
    }
    let running = this.probing.get(key);
    if (running === undefined) {
      running = probeHostSupport(folder).then((answer) => {
        this.support.set(key, answer);
        this.probing.delete(key);
        if (answer === "takes" && wantsHosts()) {
          // The definition offered so far left the hosts out; offer them now.
          this.changed.fire();
        }
        return answer;
      });
      this.probing.set(key, running);
    }
    return running;
  }

  /**
   * Offer the server, with the hosts only once a probe shows the installed Veridelta takes them.
   *
   * VS Code can start a copy of this definition without calling resolve, as
   * the Agent Host does, so the arguments offered must start on their own. A
   * Veridelta that does not take `--allow-host` refuses to start with it, so
   * the hosts wait for the probe, which runs only when the settings name a
   * host. Its answer announces a change, and the next offer carries them.
   */
  provideMcpServerDefinitions(): vscode.McpStdioServerDefinition[] {
    const probe = currentDefinition(false);
    const folder = probe?.cwd?.fsPath;
    if (probe === undefined || folder === undefined) {
      return [];
    }
    const known = this.support.get(JSON.stringify(configuredCommand()));
    if (known === undefined && wantsHosts()) {
      void this.supportFor(folder);
    }
    const definition = known === "takes" ? currentDefinition(true) : probe;
    return definition === undefined ? [] : [definition];
  }

  /**
   * Return the server to start: built from the settings and folders as they are now, with the version.
   *
   * VS Code passes the definition it kept from the last provide, which can be
   * older than a settings change made since. That object is left as it is,
   * and a new one is returned, so a revoked flag never starts and a dropped
   * flag is not dropped for good. Each probe gives up after a while, and the
   * server then starts without its answer: with no version, and without the
   * hosts. A notification says once what an older Veridelta does not hold.
   */
  async resolveMcpServerDefinition(
    kept: vscode.McpStdioServerDefinition,
  ): Promise<vscode.McpStdioServerDefinition | undefined> {
    const folder = currentDefinition(false)?.cwd?.fsPath;
    if (folder === undefined) {
      return undefined;
    }
    const [text, support] = await Promise.all([
      cliVersion(folder, { timeoutMs: PROBE_TIMEOUT_MS }),
      this.supportFor(folder),
    ]);
    const version = text === undefined ? undefined : parseVersion(text);
    // The settings may have changed while the probes ran, so read them again.
    const definition = currentDefinition(support === "takes");
    if (definition === undefined) {
      return undefined;
    }
    const shown = version === undefined ? kept.version : version.join(".");
    if (shown !== undefined) {
      definition.version = shown;
    }
    warnAboutOlder(
      version === undefined ? "The installed Veridelta" : `Veridelta ${version.join(".")}`,
      support,
      wantsHosts(),
    );
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
