// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The words that start `veridelta mcp` for a workspace: one `--root` per folder and a flag per setting.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 */

/** The settings that map onto the server's flags. */
export interface McpSettings {
  allowRowValues: boolean;
  allowQueries: boolean;
  maxRows: number;
  /** Hosts a side may connect to, each passed as `--allow-host`. */
  allowHosts: string[];
}

/** The server's own default for `--max-rows`, which the flag is left out for. */
export const DEFAULT_MAX_ROWS = 50;

/** The most rows one tool call may return, whatever the setting says. */
export const MOST_MAX_ROWS = 1000;

/** The `--max-rows` a setting asks for: its default unless a whole number of at least one, and at most `MOST_MAX_ROWS`. */
export function maxRowsOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_ROWS;
  }
  return Math.min(value, MOST_MAX_ROWS);
}

/** The settings that start the server as `veridelta mcp` alone would. */
export const DEFAULT_SETTINGS: McpSettings = {
  allowRowValues: false,
  allowQueries: false,
  maxRows: DEFAULT_MAX_ROWS,
  allowHosts: [],
};

/** The hosts `--allow-host` takes: lowercase, no scheme or port, as `package.json` also declares. */
export const HOST_PATTERN = /^([a-z0-9_-]+(\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])$/;

/**
 * Split the hosts into those Veridelta takes and those it would refuse.
 *
 * One host Veridelta refuses stops the server from starting at all, so such
 * entries are left out. Nothing is lowercased: a bucket named in another case
 * is another bucket.
 */
export function splitHosts(hosts: readonly string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const host of hosts) {
    (HOST_PATTERN.test(host) ? kept : dropped).push(host);
  }
  return { kept, dropped };
}

/** The flag that names a host the server may connect to, which Veridelta after 0.42.2 takes. */
export const ALLOW_HOST = "--allow-host";

const ALLOW_HOST_PREFIX = `${ALLOW_HOST}=`;

/**
 * The folders the server can be rooted at: those that are there now.
 *
 * Veridelta refuses to start when one root is missing, so a folder that was
 * unmounted or removed would take the server away from every other folder.
 *
 * @param folders The workspace folders, first one first.
 * @param isFolder Whether a path is a folder on disk now.
 */
export function rootFolders(folders: readonly string[], isFolder: (folder: string) => boolean): string[] {
  return folders.filter((folder) => isFolder(folder));
}

/**
 * The variables to set, or to remove with null, in the server's environment.
 *
 * The server otherwise inherits the editor's whole environment, and Veridelta
 * refuses to start on some variables it finds there. A name the environment
 * cannot hold, or a value that is not a string or null, is left out.
 */
export function serverEnv(value: unknown): Record<string, string | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string | null> = {};
  for (const [name, setting] of Object.entries(value as Record<string, unknown>)) {
    const named = name.length > 0 && !name.includes("=") && !name.includes("\0");
    if (named && (typeof setting === "string" || setting === null)) {
      env[name] = setting;
    }
  }
  return env;
}

/** A program and its arguments. */
export interface ServerCommand {
  program: string;
  args: string[];
}

/**
 * Return the command that starts the server.
 *
 * @param command The words that run Veridelta, from the `veridelta.command` setting.
 * @param folders The workspace folders, each passed as a `--root`.
 * @param settings The flags to add; a setting at the server's own default adds none.
 */
export function serverCommand(command: string[], folders: string[], settings: McpSettings): ServerCommand {
  const [program = "veridelta", ...leading] = command;
  const args = [...leading, "mcp"];
  for (const folder of folders) {
    args.push("--root", folder);
  }
  if (settings.allowRowValues) {
    args.push("--allow-row-values");
  }
  if (settings.allowQueries) {
    args.push("--allow-queries");
  }
  for (const host of settings.allowHosts) {
    // One word with `=`, so a host that starts with a dash stays the flag's value.
    args.push(`${ALLOW_HOST_PREFIX}${host}`);
  }
  if (settings.maxRows !== DEFAULT_MAX_ROWS) {
    args.push("--max-rows", String(settings.maxRows));
  }
  return { program, args };
}

/** Whether `veridelta mcp --help` names `--allow-host`, which a Veridelta before it does not take. */
export function takesAllowHost(help: string): boolean {
  return /--allow-host(?![\w-])/.test(help);
}

/** Whether the installed Veridelta takes `--allow-host`, as far as a probe of its help could tell. */
export type HostSupport = "takes" | "lacks" | "unknown";

/** The warnings about an older Veridelta this session has already shown. */
export interface OlderWarnings {
  unknown: boolean;
  lacks: boolean;
  /** Whether a warning about a Veridelta without --allow-host has named the hosts setting. */
  lacksHosts: boolean;
}

/**
 * The warning to show about what the installed Veridelta holds, if any, each kind at most once.
 *
 * A probe that could not tell runs again later, and a Veridelta it then finds
 * without `--allow-host` still gets its own warning.
 *
 * @param shown The warnings shown so far; the one returned is marked shown.
 * @param installed How to name the installed Veridelta, such as `Veridelta 0.42.2`.
 */
export function olderWarning(
  shown: OlderWarnings,
  installed: string,
  support: HostSupport,
  hostsSet: boolean,
): string | undefined {
  if (support === "unknown" && hostsSet && !shown.unknown && !shown.lacks) {
    shown.unknown = true;
    return "The extension could not tell whether the installed Veridelta takes --allow-host, so the agent's server starts without the hosts veridelta.mcp.allowHosts lists. A Veridelta without --allow-host lets the tools connect to any host a configuration names. The next start of the server asks again.";
  }
  if (support === "lacks" && !shown.lacks) {
    shown.lacks = true;
    shown.lacksHosts = hostsSet;
    const hosts = hostsSet
      ? " veridelta.mcp.allowHosts does not apply to it, so its hosts are left out."
      : "";
    return `${installed} has no --allow-host. With it, the agent's tools can connect to any host a configuration names, and a tool's error can quote a value from the data with veridelta.mcp.allowRowValues off.${hosts} A Veridelta release after 0.42.2 holds the tools to the hosts veridelta.mcp.allowHosts lists and keeps database errors that quote values from the agent.`;
  }
  if (support === "lacks" && hostsSet && !shown.lacksHosts) {
    shown.lacksHosts = true;
    return `${installed} has no --allow-host, so veridelta.mcp.allowHosts does not apply to it, and its hosts are left out.`;
  }
  return undefined;
}
