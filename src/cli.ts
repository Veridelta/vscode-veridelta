// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Run the Veridelta command line as the `veridelta.command` setting spells it.
 *
 * The setting is a list of words, `["veridelta"]` by default, so a project that
 * runs it through uv sets `["uv", "run", "veridelta"]`. The extension host's PATH
 * can differ from a shell's, which is what the setting is for.
 */

import { execFile } from "node:child_process";

import * as vscode from "vscode";

/** What one run of the command gave back. */
export interface Finished {
  stdout: string;
  stderr: string;
  /** The exit code, or null when a signal ended the process. */
  code: number | null;
}

/** The command was not found: the first word of the setting is not on PATH. */
export class CommandNotFound extends Error {
  constructor(readonly command: string) {
    super(`Veridelta was not found: '${command}' is not on the extension host's PATH.`);
    this.name = "CommandNotFound";
  }
}

const DEFAULT_COMMAND = "veridelta";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Read the `veridelta.command` setting, falling back to `["veridelta"]` when it is empty. */
export function configuredCommand(): string[] {
  const words: unknown = vscode.workspace.getConfiguration("veridelta").get("command");
  const kept = Array.isArray(words)
    ? words.filter((word): word is string => typeof word === "string" && word.length > 0)
    : [];
  return kept.length > 0 ? kept : [DEFAULT_COMMAND];
}

/**
 * Run Veridelta with `args` after the configured words, in `cwd`.
 *
 * A non-zero exit code is a result, not an error: `validate` exits 1 on an
 * error finding and 3 when it cannot finish, and each prints JSON to read.
 */
export function runVeridelta(
  args: string[],
  cwd: string,
  command: string[] = configuredCommand(),
): Promise<Finished> {
  const [program = DEFAULT_COMMAND, ...leading] = command;
  return new Promise((resolve, reject) => {
    execFile(
      program,
      [...leading, ...args],
      { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, code: 0 });
        } else if (typeof error.code === "number") {
          resolve({ stdout, stderr, code: error.code });
        } else if (error.code === "ENOENT") {
          reject(new CommandNotFound(program));
        } else if (error.code === undefined || error.code === null) {
          resolve({ stdout, stderr, code: null });
        } else {
          reject(error instanceof Error ? error : new Error(error.message));
        }
      },
    );
  });
}

/** Return what `veridelta --version` prints, or undefined when the command cannot run or fails. */
export async function cliVersion(
  cwd: string,
  command: string[] = configuredCommand(),
): Promise<string | undefined> {
  try {
    const finished = await runVeridelta(["--version"], cwd, command);
    return finished.code === 0 ? finished.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}
