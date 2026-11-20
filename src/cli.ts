// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Run the Veridelta command line as the `veridelta.command` setting spells it.
 *
 * The setting is a list of words, `["veridelta"]` by default, so a project that
 * runs it through uv sets `["uv", "run", "veridelta"]`. The extension host's PATH
 * can differ from a shell's, which is what the setting is for.
 */

import * as vscode from "vscode";

import { runProgram, type Finished } from "./spawn";

export { CommandNotFound, FolderNotFound, RunCancelled, RunTimedOut, type Finished } from "./spawn";

/** How to run the command: which words, a signal that ends it early, and how long it may take. */
export interface RunOptions {
  command?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_COMMAND = "veridelta";

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
 * Aborting the signal, or running past `timeoutMs`, ends the process and
 * everything it started, and the promise rejects with `RunCancelled` or
 * `RunTimedOut`.
 */
export function runVeridelta(args: string[], cwd: string, options: RunOptions = {}): Promise<Finished> {
  const [program = DEFAULT_COMMAND, ...leading] = options.command ?? configuredCommand();
  return runProgram(program, [...leading, ...args], {
    cwd,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
}

/** Return what `veridelta --version` prints, or undefined when the command cannot run or fails. */
export async function cliVersion(cwd: string, options: RunOptions = {}): Promise<string | undefined> {
  try {
    const finished = await runVeridelta(["--version"], cwd, options);
    return finished.code === 0 ? finished.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}
