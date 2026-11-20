// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_MAX_ROWS,
  DEFAULT_SETTINGS,
  hasAllowHost,
  maxRowsOf,
  MOST_MAX_ROWS,
  HOST_PATTERN,
  rootFolders,
  serverCommand,
  splitHosts,
  takesAllowHost,
  withoutAllowHost,
} from "../../src/mcpArgs";

describe("serverCommand", () => {
  it("passes each folder as a root and adds no flag at the defaults", () => {
    assert.deepEqual(serverCommand(["veridelta"], ["/a", "/b"], DEFAULT_SETTINGS), {
      program: "veridelta",
      args: ["mcp", "--root", "/a", "--root", "/b"],
    });
  });

  it("keeps the configured words ahead of the subcommand", () => {
    assert.deepEqual(serverCommand(["uv", "run", "veridelta"], ["/a"], DEFAULT_SETTINGS), {
      program: "uv",
      args: ["run", "veridelta", "mcp", "--root", "/a"],
    });
  });

  it("adds each flag only when its setting asks for it", () => {
    assert.deepEqual(
      serverCommand(["veridelta"], ["/a"], { ...DEFAULT_SETTINGS, allowRowValues: true }).args,
      ["mcp", "--root", "/a", "--allow-row-values"],
    );
    assert.deepEqual(serverCommand(["veridelta"], ["/a"], { ...DEFAULT_SETTINGS, allowQueries: true }).args, [
      "mcp",
      "--root",
      "/a",
      "--allow-queries",
    ]);
    assert.deepEqual(serverCommand(["veridelta"], ["/a"], { ...DEFAULT_SETTINGS, maxRows: 10 }).args, [
      "mcp",
      "--root",
      "/a",
      "--max-rows",
      "10",
    ]);
    assert.deepEqual(
      serverCommand(["veridelta"], ["/a"], {
        allowRowValues: true,
        allowQueries: true,
        maxRows: 500,
        allowHosts: ["db.internal"],
      }).args,
      [
        "mcp",
        "--root",
        "/a",
        "--allow-row-values",
        "--allow-queries",
        "--allow-host=db.internal",
        "--max-rows",
        "500",
      ],
    );
  });

  it("passes each allowed host as one word, so a host cannot read as another flag", () => {
    assert.deepEqual(
      serverCommand(["veridelta"], ["/a"], { ...DEFAULT_SETTINGS, allowHosts: ["db.internal", "-x"] }).args,
      ["mcp", "--root", "/a", "--allow-host=db.internal", "--allow-host=-x"],
    );
  });

  it("falls back to veridelta when the command is empty", () => {
    assert.deepEqual(serverCommand([], [], DEFAULT_SETTINGS), { program: "veridelta", args: ["mcp"] });
  });
});

describe("allowed hosts on an older Veridelta", () => {
  it("reads whether the server's help names --allow-host", () => {
    assert.equal(takesAllowHost("  --allow-row-values  Let ...\n  --allow-queries  Let ..."), false);
    assert.equal(takesAllowHost("  --allow-host HOST  A host a side may connect to"), true);
    assert.equal(takesAllowHost("  --allow-hosts LIST"), false);
  });

  it("finds and drops the hosts and nothing else", () => {
    const args = ["run", "veridelta", "mcp", "--root", "/a", "--allow-host=db.internal", "--max-rows", "5"];
    assert.equal(hasAllowHost(args), true);
    assert.deepEqual(withoutAllowHost(args), ["run", "veridelta", "mcp", "--root", "/a", "--max-rows", "5"]);
    assert.equal(hasAllowHost(withoutAllowHost(args)), false);
  });
});

describe("maxRowsOf", () => {
  it("keeps a whole number from one up to the most", () => {
    assert.equal(maxRowsOf(1), 1);
    assert.equal(maxRowsOf(200), 200);
    assert.equal(maxRowsOf(MOST_MAX_ROWS), MOST_MAX_ROWS);
  });

  it("holds a larger number to the most", () => {
    assert.equal(maxRowsOf(1_000_000), MOST_MAX_ROWS);
    assert.equal(maxRowsOf(Number.MAX_SAFE_INTEGER), MOST_MAX_ROWS);
  });

  it("falls back to the default for anything else", () => {
    for (const value of [
      0,
      -3,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "abc",
      "100",
      null,
      undefined,
      true,
    ]) {
      assert.equal(maxRowsOf(value), DEFAULT_MAX_ROWS, String(value));
    }
  });
});

describe("rootFolders", () => {
  it("keeps the folders that are there, in order, so the first one left is the working folder", () => {
    const there = new Set(["/b", "/c"]);
    assert.deepEqual(
      rootFolders(["/a", "/b", "/c"], (folder) => there.has(folder)),
      ["/b", "/c"],
    );
  });

  it("keeps nothing when no folder is there", () => {
    assert.deepEqual(
      rootFolders(["/a"], () => false),
      [],
    );
  });
});

describe("splitHosts", () => {
  it("keeps hosts and addresses Veridelta takes, and drops the rest", () => {
    assert.deepEqual(
      splitHosts([
        "db.internal",
        "10.0.0.5",
        "[::1]",
        "my_bucket",
        "Db.Internal",
        "https://x.example",
        "x.example:5432",
        "",
        "a..b",
      ]),
      {
        kept: ["db.internal", "10.0.0.5", "[::1]", "my_bucket"],
        dropped: ["Db.Internal", "https://x.example", "x.example:5432", "", "a..b"],
      },
    );
  });

  it("uses the pattern package.json declares for the setting", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as {
      contributes: { configuration: { properties: Record<string, { items?: { pattern?: string } }> } };
    };
    const declared =
      manifest.contributes.configuration.properties["veridelta.mcp.allowHosts"]?.items?.pattern;
    assert.equal(declared, HOST_PATTERN.source);
  });
});
