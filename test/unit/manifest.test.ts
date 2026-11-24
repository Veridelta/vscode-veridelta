// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the manifest promises about trust: settings a workspace's settings cannot set, and workspaces the extension stays off in.
 */

import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

interface Setting {
  scope?: string;
  restricted?: boolean;
}

interface Manifest {
  capabilities?: {
    untrustedWorkspaces?: { supported?: unknown; description?: unknown };
    virtualWorkspaces?: { supported?: unknown; description?: unknown };
  };
  contributes: { configuration: { properties: Record<string, Setting> } };
}

/** The manifest at the repository root; the compiled test runs from out/test/unit. */
const manifest = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
) as Manifest;

const settings = manifest.contributes.configuration.properties;

describe("package.json", () => {
  it("stays off in untrusted and virtual workspaces, and says why", () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
    assert.equal(typeof manifest.capabilities.untrustedWorkspaces.description, "string");
    assert.equal(manifest.capabilities.virtualWorkspaces?.supported, false);
    assert.equal(typeof manifest.capabilities.virtualWorkspaces.description, "string");
  });

  it("ignores an untrusted workspace's veridelta.command", () => {
    assert.equal(settings["veridelta.command"]?.restricted, true);
  });

  it("takes every agent grant from user settings only", () => {
    for (const name of [
      "veridelta.mcp.allowRowValues",
      "veridelta.mcp.allowQueries",
      "veridelta.mcp.allowHosts",
      "veridelta.mcp.maxRows",
      "veridelta.mcp.env",
    ]) {
      assert.equal(settings[name]?.scope, "machine", name);
    }
  });
});
