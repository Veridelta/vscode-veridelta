// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Run a program to the end, or end it and everything it started.
 *
 * A configured command can be a wrapper, such as `uv run veridelta` or a
 * script, that starts Veridelta as its own child. Ending only the direct
 * child would leave that comparison running, so a cancel or a timeout ends
 * the whole tree: on Linux and macOS the program leads its own process
 * group and the group gets the signal, and on Windows `taskkill /T` ends
 * the tree.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

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

/** The folder the command was to run in does not exist. */
export class FolderNotFound extends Error {
  constructor(readonly folder: string) {
    super(`The folder '${folder}' does not exist, so Veridelta cannot run there.`);
    this.name = "FolderNotFound";
  }
}

/** The run was cancelled: its process was ended before it finished. */
export class RunCancelled extends Error {
  constructor() {
    super("The Veridelta run was cancelled.");
    this.name = "RunCancelled";
  }
}

/** The run took longer than it was given, so its process was ended. */
export class RunTimedOut extends Error {
  constructor(readonly seconds: number) {
    super(`Veridelta did not finish within ${String(seconds)} seconds, so it was ended.`);
    this.name = "RunTimedOut";
  }
}

/** How to run a program. */
export interface SpawnOptions {
  cwd: string;
  /** Ends the run, and the promise rejects with `RunCancelled`. */
  signal?: AbortSignal | undefined;
  /** Ends the run after this many milliseconds, and the promise rejects with `RunTimedOut`. */
  timeoutMs?: number | undefined;
  /** The most bytes kept from each of stdout and stderr; more ends the run. */
  maxBytes?: number;
  /** How long a tree has after the first signal before it is killed outright. */
  graceMs?: number;
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const GRACE_MS = 2000;

/** The processes still running, so `endAll` can end them when the extension stops. */
const live = new Set<ChildProcess>();

/** The program and words that end a process tree on Windows, or undefined where signals do it. */
export function treeKillCommand(platform: NodeJS.Platform, pid: number): [string, string[]] | undefined {
  return platform === "win32" ? ["taskkill", ["/pid", String(pid), "/T", "/F"]] : undefined;
}

/** End a child and everything it started; `force` skips the polite signal. */
function endTree(child: ChildProcess, force: boolean): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  const windows = treeKillCommand(process.platform, pid);
  if (windows !== undefined) {
    const [program, args] = windows;
    execFile(program, args, { windowsHide: true }, () => {
      // The tree may already be gone, which is what was wanted.
    });
    return;
  }
  try {
    // The child leads its own process group, so a negative pid reaches the whole group.
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    // The group is already gone.
  }
}

/** End every process still running, as the extension stops. */
export function endAll(): void {
  for (const child of live) {
    endTree(child, true);
  }
  live.clear();
}

/**
 * Run `program` with `args` in `options.cwd` and collect what it prints.
 *
 * A non-zero exit code is a result, not an error. Standard input is closed,
 * so a program that would read it sees its end at once.
 */
export function runProgram(program: string, args: string[], options: SpawnOptions): Promise<Finished> {
  const { signal, timeoutMs } = options;
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
  const graceMs = options.graceMs ?? GRACE_MS;
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new RunCancelled());
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(program, args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // On Windows, detached opens a new console, and taskkill ends the tree instead.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    live.add(child);

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let stopped: Error | undefined;
    let forceTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const stop = (reason: Error): void => {
      if (stopped !== undefined) {
        return;
      }
      stopped = reason;
      endTree(child, false);
      forceTimer = setTimeout(() => {
        endTree(child, true);
        // A process that left the group can still hold the output pipes, and
        // 'close' waits for every holder. The tree is being ended, so stop
        // waiting for it.
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, graceMs);
    };
    const onAbort = (): void => {
      stop(new RunCancelled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        stop(new RunTimedOut(Math.round(timeoutMs / 1000)));
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxBytes) {
        stop(new Error(`Veridelta printed more than ${String(maxBytes)} bytes, so it was ended.`));
      } else {
        out.push(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > maxBytes) {
        stop(new Error(`Veridelta printed more than ${String(maxBytes)} bytes, so it was ended.`));
      } else {
        err.push(chunk);
      }
    });

    let settled = false;
    const finish = (): void => {
      settled = true;
      live.delete(child);
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timeoutTimer);
      clearTimeout(forceTimer);
    };
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      finish();
      if (error.code === "ENOENT") {
        reject(existsSync(options.cwd) ? new CommandNotFound(program) : new FolderNotFound(options.cwd));
      } else {
        reject(error);
      }
    });
    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      finish();
      if (stopped !== undefined) {
        // A stopped tree is ended outright, so nothing it started outlives it.
        endTree(child, true);
        reject(stopped);
        return;
      }
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
      });
    });
  });
}
