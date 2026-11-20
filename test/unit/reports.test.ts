// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { KEEP_FOR_MS, KEEP_PER_CONFIGURATION, reportsToRemove } from "../../src/reports";

const NOW = Date.UTC(2026, 10, 20);
const MINUTE = 60 * 1000;

describe("reportsToRemove", () => {
  it("keeps the newest few reports of the configuration just run", () => {
    const entries = Array.from({ length: KEEP_PER_CONFIGURATION + 2 }, (_, index) => ({
      name: `veridelta-ab12cd34-${String(index)}.html`,
      mtimeMs: NOW - index * MINUTE,
    }));
    assert.deepEqual(reportsToRemove(entries, "veridelta-ab12cd34-", NOW), [
      `veridelta-ab12cd34-${String(KEEP_PER_CONFIGURATION)}.html`,
      `veridelta-ab12cd34-${String(KEEP_PER_CONFIGURATION + 1)}.html`,
    ]);
  });

  it("leaves another configuration's recent reports alone", () => {
    const entries = Array.from({ length: KEEP_PER_CONFIGURATION + 2 }, (_, index) => ({
      name: `other-99887766-${String(index)}.html`,
      mtimeMs: NOW - index * MINUTE,
    }));
    assert.deepEqual(reportsToRemove(entries, "veridelta-ab12cd34-", NOW), []);
  });

  it("removes any report older than a week", () => {
    const entries = [
      { name: "other-99887766-a.html", mtimeMs: NOW - KEEP_FOR_MS - MINUTE },
      { name: "other-99887766-b.html", mtimeMs: NOW - KEEP_FOR_MS + MINUTE },
      { name: "notes.txt", mtimeMs: 0 },
    ];
    assert.deepEqual(reportsToRemove(entries, "veridelta-ab12cd34-", NOW), ["other-99887766-a.html"]);
  });
});
