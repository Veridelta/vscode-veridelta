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
}

/** The server's own default for `--max-rows`, which the flag is left out for. */
export const DEFAULT_MAX_ROWS = 50;

/** The settings that start the server as `veridelta mcp` alone would. */
export const DEFAULT_SETTINGS: McpSettings = {
  allowRowValues: false,
  allowQueries: false,
  maxRows: DEFAULT_MAX_ROWS,
};

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
  if (settings.maxRows !== DEFAULT_MAX_ROWS) {
    args.push("--max-rows", String(settings.maxRows));
  }
  return { program, args };
}
