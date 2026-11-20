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
