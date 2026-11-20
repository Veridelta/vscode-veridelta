// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  hasAllowHost,
  serverCommand,
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
