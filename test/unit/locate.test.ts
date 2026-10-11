// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { firstLine, rangeFor, type Range } from "../../src/locate";

const CONFIG = [
  "source:",
  "  path: legacy.csv",
  "  format: parquett",
  "target:",
  "  path: modern.csv",
  "primary_keys: [id]",
  "rules:",
  "  - column: amount",
  "    case_insensitve: true",
  "  - column: status",
  "    value_map:",
  "      a: b",
  "",
].join("\n");

function range(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

describe("rangeFor", () => {
  it("spans a known setting with a wrong value, from its key to the end of its value", () => {
    assert.deepEqual(rangeFor(CONFIG, { path: ["source", "format"] }), range(2, 2, 2, 18));
  });

  it("spans a misspelt setting the same way", () => {
    assert.deepEqual(rangeFor(CONFIG, { path: ["rules", 0, "case_insensitve"] }), range(8, 4, 8, 25));
  });

  it("lands a missing setting on the block that should hold it", () => {
    assert.deepEqual(rangeFor(CONFIG, { path: ["target", "format"] }), range(3, 0, 3, 6));
  });

  it("lands a block value on its key", () => {
    assert.deepEqual(rangeFor(CONFIG, { path: ["rules", 1, "value_map"] }), range(10, 4, 10, 13));
  });

  it("lands a list item on its first line", () => {
    assert.deepEqual(rangeFor(CONFIG, { path: ["rules", 1] }), range(9, 4, 9, 18));
  });

  it("lands a line and column on that line, from the column to its end", () => {
    assert.deepEqual(rangeFor(CONFIG, { line: 2, column: 5 }), range(1, 4, 1, 18));
    assert.deepEqual(rangeFor(CONFIG, { line: 3 }), range(2, 0, 2, 18));
  });

  it("clamps a line past the end to the last line", () => {
    assert.deepEqual(rangeFor("a: 1\nb: 2", { line: 99, column: 99 }), range(1, 4, 1, 4));
  });

  it("falls back to the first line for what the text does not place", () => {
    const first = range(0, 0, 0, 7);
    assert.deepEqual(rangeFor(CONFIG, undefined), first);
    assert.deepEqual(rangeFor(CONFIG, {}), first);
    assert.deepEqual(rangeFor(CONFIG, { path: [] }), first);
    assert.deepEqual(rangeFor(CONFIG, { path: ["nowhere", "at", "all"] }), first);
    assert.deepEqual(firstLine(CONFIG), first);
  });

  it("keeps its columns in text with carriage returns", () => {
    const text = "a: 1\r\nb: 2\r\n";
    assert.deepEqual(rangeFor(text, { path: ["b"] }), range(1, 0, 1, 4));
    assert.deepEqual(rangeFor(text, { line: 1 }), range(0, 0, 0, 4));
    assert.deepEqual(firstLine(text), range(0, 0, 0, 4));
  });

  it("does not throw on text that does not parse", () => {
    const placed = rangeFor("a: [1,\n", { path: ["a"] });
    assert.equal(placed.start.line, 0);
  });
});
