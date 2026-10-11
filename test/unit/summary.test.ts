// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { parseRunOutput, verdictLine, type RunSummary } from "../../src/summary";

const TEXT = "Veridelta Execution Summary\n===========================\nStatus:        FAILED\n";

const PRINTED = {
  total_rows_source: 3,
  total_rows_target: 3,
  added_count: 1,
  removed_count: 1,
  changed_count: 1,
  column_mismatches: { status: 1 },
  is_match: false,
  accepted_count: 0,
  total_mismatches: 3,
  mismatch_ratio: 1.0,
  match_rate_percentage: 0.0,
  is_perfect_match: false,
  volume_shift: 0,
  report_summary: TEXT,
};

const SUMMARY: RunSummary = {
  isMatch: false,
  added: 1,
  removed: 1,
  changed: 1,
  accepted: 0,
  reportSummary: TEXT,
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseRunOutput", () => {
  it("reads the summary at exit code 0 and 1", () => {
    for (const code of [0, 1]) {
      assert.deepEqual(parseRunOutput(json(PRINTED), code), { kind: "summary", summary: SUMMARY });
    }
  });

  it("reads the error object at exit code 3", () => {
    const error = { type: "ConfigError", message: "Configuration file not found" };
    assert.deepEqual(parseRunOutput(json({ error }), 3), { kind: "error", error });
  });

  it("takes a missing accepted_count as zero", () => {
    const older: Record<string, unknown> = { ...PRINTED };
    delete older.accepted_count;
    assert.deepEqual(parseRunOutput(json(older), 1), { kind: "summary", summary: SUMMARY });
  });

  it("refuses output it does not know", () => {
    const unparsable = { kind: "unparsable" };
    assert.deepEqual(parseRunOutput("", 0), unparsable);
    assert.deepEqual(parseRunOutput("[]", 0), unparsable);
    assert.deepEqual(parseRunOutput(json(PRINTED), 2), unparsable);
    assert.deepEqual(parseRunOutput(json(PRINTED), null), unparsable);
    assert.deepEqual(parseRunOutput(json(PRINTED), 3), unparsable);
    assert.deepEqual(parseRunOutput(json({ error: { type: "ConfigError" } }), 3), unparsable);
    assert.deepEqual(parseRunOutput(json({ ...PRINTED, is_match: "no" }), 1), unparsable);
    assert.deepEqual(parseRunOutput(json({ ...PRINTED, added_count: -1 }), 1), unparsable);
    assert.deepEqual(parseRunOutput(json({ ...PRINTED, changed_count: 1.5 }), 1), unparsable);
    assert.deepEqual(parseRunOutput(json({ ...PRINTED, report_summary: 7 }), 1), unparsable);
  });
});

describe("verdictLine", () => {
  it("names the verdict and the counts", () => {
    assert.equal(verdictLine(SUMMARY), "Veridelta: FAILED. Added 1, removed 1, changed 1.");
    assert.equal(
      verdictLine({ ...SUMMARY, isMatch: true, added: 0, removed: 0, changed: 0 }),
      "Veridelta: PASSED. Added 0, removed 0, changed 0.",
    );
  });

  it("mentions accepted rows only when there are some", () => {
    assert.equal(
      verdictLine({ ...SUMMARY, accepted: 3 }),
      "Veridelta: FAILED. Added 1, removed 1, changed 1, 3 accepted.",
    );
  });
});
