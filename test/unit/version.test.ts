// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { isAtLeast, LOCATIONS_VERSION, MINIMUM_VERSION, parseVersion } from "../../src/version";

describe("parseVersion", () => {
  it("reads what the command prints", () => {
    assert.deepEqual(parseVersion("veridelta 0.35.1\n"), [0, 35, 1]);
  });

  it("reads a bare version", () => {
    assert.deepEqual(parseVersion("0.36.0"), [0, 36, 0]);
  });

  it("gives undefined for anything else", () => {
    assert.equal(parseVersion(""), undefined);
    assert.equal(parseVersion("veridelta"), undefined);
    assert.equal(parseVersion("1.2"), undefined);
  });
});

describe("isAtLeast", () => {
  it("compares major, then minor, then patch", () => {
    assert.ok(isAtLeast("0.36.0", "0.35.1"));
    assert.ok(isAtLeast("1.0.0", "0.99.99"));
    assert.ok(isAtLeast("0.35.1", "0.35.1"));
    assert.ok(isAtLeast("0.35.10", "0.35.9"));
    assert.ok(!isAtLeast("0.35.0", "0.35.1"));
    assert.ok(!isAtLeast("0.34.9", "0.35.1"));
    assert.ok(!isAtLeast("0.99.99", "1.0.0"));
  });

  it("reads the command's output as the version", () => {
    assert.ok(isAtLeast("veridelta 0.36.0", LOCATIONS_VERSION));
    assert.ok(isAtLeast("veridelta 0.35.1", MINIMUM_VERSION));
    assert.ok(!isAtLeast("veridelta 0.35.1", LOCATIONS_VERSION));
  });

  it("is false when either side does not parse", () => {
    assert.ok(!isAtLeast("", MINIMUM_VERSION));
    assert.ok(!isAtLeast("0.36.0", "latest"));
  });
});
