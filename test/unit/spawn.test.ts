// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CommandNotFound,
  endAll,
  FolderNotFound,
  RunCancelled,
  runProgram,
  RunTimedOut,
  treeKillCommand,
} from "../../src/spawn";

const NODE = process.execPath;

/** Whether a process is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait until a condition holds, or fail after a while. */
async function until(condition: () => boolean, what: string, ms = 10_000): Promise<void> {
  for (let waited = 0; waited < ms; waited += 50) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting until ${what}`);
}

/**
 * A wrapper that ignores SIGTERM and starts a child that does too, as a
 * script around Veridelta might. The child writes its pid to `pidFile`.
 */
function stubbornWrapper(pidFile: string): string[] {
  const grandchild = `process.on("SIGTERM", () => {}); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const wrapper = `process.on("SIGTERM", () => {}); require("child_process").spawn(${JSON.stringify(NODE)}, ["-e", ${JSON.stringify(grandchild)}], { stdio: "inherit" }); setInterval(() => {}, 1000);`;
  return ["-e", wrapper];
}

describe("runProgram", function () {
  this.timeout(20_000);

  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "veridelta-spawn-"));
  });

  afterEach(() => {
    endAll();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("collects what the program prints and its exit code", async () => {
    const finished = await runProgram(
      NODE,
      ["-e", 'process.stdout.write("out é"); process.stderr.write("err"); process.exit(3)'],
      { cwd: folder },
    );
    assert.deepEqual(finished, { stdout: "out é", stderr: "err", code: 3 });
  });

  it("runs in the folder it is given, with standard input closed", async () => {
    const finished = await runProgram(
      NODE,
      ["-e", 'process.stdout.write(process.cwd()); process.stdin.on("end", () => process.exit(0)).resume()'],
      { cwd: folder, timeoutMs: 5000 },
    );
    assert.equal(fs.realpathSync(finished.stdout), fs.realpathSync(folder));
  });

  it("says when the program is not found", async () => {
    await assert.rejects(runProgram("veridelta-not-installed-here", [], { cwd: folder }), CommandNotFound);
  });

  it("says when the folder does not exist, rather than blaming the program", async () => {
    await assert.rejects(runProgram(NODE, ["-e", ""], { cwd: path.join(folder, "gone") }), FolderNotFound);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runProgram(NODE, ["-e", ""], { cwd: folder, signal: controller.signal }),
      RunCancelled,
    );
  });

  it("ends the whole tree on cancel, even a wrapper that ignores SIGTERM", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const pidFile = path.join(folder, "child.pid");
    const controller = new AbortController();
    const running = runProgram(NODE, stubbornWrapper(pidFile), {
      cwd: folder,
      signal: controller.signal,
      graceMs: 300,
    });
    await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8") !== "", "the child starts");
    const child = Number(fs.readFileSync(pidFile, "utf8"));
    controller.abort();
    await assert.rejects(running, RunCancelled);
    await until(() => !alive(child), "the child is gone", 3000);
  });

  it("ends the whole tree when the run takes too long", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const pidFile = path.join(folder, "child.pid");
    const running = runProgram(NODE, stubbornWrapper(pidFile), {
      cwd: folder,
      timeoutMs: 1500,
      graceMs: 300,
    });
    await assert.rejects(running, RunTimedOut);
    const child = Number(fs.readFileSync(pidFile, "utf8"));
    await until(() => !alive(child), "the child is gone", 3000);
  });

  it("ends a run that prints more than it may keep", async () => {
    await assert.rejects(
      runProgram(NODE, ["-e", 'process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)'], {
        cwd: folder,
        maxBytes: 1024,
        graceMs: 300,
      }),
      /printed more than 1024 bytes/,
    );
  });

  it("ends what is still running when the extension stops", async function () {
    if (process.platform === "win32") {
      this.skip();
    }
    const pidFile = path.join(folder, "child.pid");
    const running = runProgram(NODE, stubbornWrapper(pidFile), { cwd: folder });
    await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8") !== "", "the child starts");
    const child = Number(fs.readFileSync(pidFile, "utf8"));
    endAll();
    const finished = await running;
    assert.equal(finished.code, null, "a signal ended the wrapper");
    await until(() => !alive(child), "the child is gone", 3000);
  });
});

describe("treeKillCommand", () => {
  it("uses taskkill on Windows, for the pid and everything under it", () => {
    assert.deepEqual(treeKillCommand("win32", 4242), ["taskkill", ["/pid", "4242", "/T", "/F"]]);
  });

  it("leaves Linux and macOS to process group signals", () => {
    assert.equal(treeKillCommand("linux", 4242), undefined);
    assert.equal(treeKillCommand("darwin", 4242), undefined);
  });
});
