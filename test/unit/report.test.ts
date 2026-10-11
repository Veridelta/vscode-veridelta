// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { parseOutput, problemsOf, type Parsed, type ValidationReport } from "../../src/report";

const DETAIL = "Input should be 'csv' or 'parquet'";
const FAILURE = `Configuration Validation Failed:\n  - [source -> format]: ${DETAIL}`;
const WARNING = "Environment variable 'X' is not set";

const REPORT: ValidationReport = {
  config: "veridelta.yaml",
  valid: false,
  errors: [FAILURE],
  warnings: [WARNING],
  findings: [
    { severity: "error", message: FAILURE, locations: [{ path: ["source", "format"], message: DETAIL }] },
    { severity: "warning", message: WARNING, locations: [] },
  ],
};

const OLDER: ValidationReport = {
  config: "veridelta.yaml",
  valid: false,
  errors: [FAILURE],
  warnings: [WARNING],
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

function reportOf(parsed: Parsed): ValidationReport {
  if (parsed.kind !== "report") {
    assert.fail(`expected a report, got ${parsed.kind}`);
  }
  return parsed.report;
}

describe("parseOutput", () => {
  it("reads the report at exit code 0 and 1", () => {
    for (const code of [0, 1]) {
      assert.deepEqual(parseOutput(json(REPORT), code), { kind: "report", report: REPORT });
    }
  });

  it("reads the error object at exit code 3", () => {
    const error = { type: "ConfigError", message: "Configuration file not found" };
    assert.deepEqual(parseOutput(json({ error }), 3), { kind: "error", error });
  });

  it("reads a report without findings, from a Veridelta before 0.36.0", () => {
    assert.deepEqual(parseOutput(json(OLDER), 1), { kind: "report", report: OLDER });
  });

  it("keeps the location fields it knows and drops the rest", () => {
    const printed = {
      ...OLDER,
      findings: [
        {
          severity: "error",
          message: FAILURE,
          locations: [{ path: ["rules", 0], line: 2, column: 5, message: "m", extra: true }],
        },
      ],
    };
    assert.deepEqual(reportOf(parseOutput(json(printed), 1)).findings?.[0]?.locations, [
      { path: ["rules", 0], line: 2, column: 5, message: "m" },
    ]);
  });

  it("refuses output it does not know", () => {
    const unparsable = { kind: "unparsable" };
    assert.deepEqual(parseOutput("", 0), unparsable);
    assert.deepEqual(parseOutput("not json", 0), unparsable);
    assert.deepEqual(parseOutput("[]", 0), unparsable);
    assert.deepEqual(parseOutput(json(REPORT), 2), unparsable);
    assert.deepEqual(parseOutput(json(REPORT), null), unparsable);
    assert.deepEqual(parseOutput(json(REPORT), 3), unparsable);
    assert.deepEqual(parseOutput(json({ error: { type: "ConfigError" } }), 3), unparsable);
    assert.deepEqual(parseOutput(json({ ...REPORT, errors: "nope" }), 1), unparsable);
    assert.deepEqual(parseOutput(json({ ...REPORT, findings: "nope" }), 1), unparsable);
    assert.deepEqual(
      parseOutput(json({ ...REPORT, findings: [{ severity: "fatal", message: "x", locations: [] }] }), 1),
      unparsable,
    );
    assert.deepEqual(
      parseOutput(json({ ...REPORT, findings: [{ severity: "error", message: "x", locations: [1] }] }), 1),
      unparsable,
    );
  });
});

describe("problemsOf", () => {
  it("gives one problem per location, named by its path and its own message", () => {
    const parsed: Parsed = {
      kind: "report",
      report: {
        ...OLDER,
        findings: [
          {
            severity: "error",
            message: "two problems",
            locations: [
              { path: ["rules", 0, "case_insensitve"], message: "Extra inputs are not permitted" },
              { path: ["target", "path"], message: "Field required" },
            ],
          },
        ],
      },
    };
    assert.deepEqual(problemsOf(parsed), [
      {
        severity: "error",
        message: "[rules -> 0 -> case_insensitve]: Extra inputs are not permitted",
        location: { path: ["rules", 0, "case_insensitve"], message: "Extra inputs are not permitted" },
      },
      {
        severity: "error",
        message: "[target -> path]: Field required",
        location: { path: ["target", "path"], message: "Field required" },
      },
    ]);
  });

  it("keeps the finding's message when a location has none", () => {
    const parsed: Parsed = {
      kind: "report",
      report: {
        ...OLDER,
        findings: [
          { severity: "error", message: "Failed to parse YAML", locations: [{ line: 2, column: 5 }] },
        ],
      },
    };
    assert.deepEqual(problemsOf(parsed), [
      { severity: "error", message: "Failed to parse YAML", location: { line: 2, column: 5 } },
    ]);
  });

  it("uses a location's message alone when it has no path", () => {
    const parsed: Parsed = {
      kind: "report",
      report: {
        ...OLDER,
        findings: [{ severity: "warning", message: "long", locations: [{ message: "short" }] }],
      },
    };
    assert.deepEqual(problemsOf(parsed), [
      { severity: "warning", message: "short", location: { message: "short" } },
    ]);
  });

  it("leaves a finding without locations for the first line", () => {
    assert.deepEqual(problemsOf({ kind: "report", report: REPORT }), [
      {
        severity: "error",
        message: `[source -> format]: ${DETAIL}`,
        location: { path: ["source", "format"], message: DETAIL },
      },
      { severity: "warning", message: WARNING, location: undefined },
    ]);
  });

  it("maps errors then warnings when the report has no findings", () => {
    assert.deepEqual(problemsOf({ kind: "report", report: OLDER }), [
      { severity: "error", message: FAILURE, location: undefined },
      { severity: "warning", message: WARNING, location: undefined },
    ]);
  });

  it("names the error type for an error object", () => {
    const parsed: Parsed = { kind: "error", error: { type: "ConfigError", message: "no such file" } };
    assert.deepEqual(problemsOf(parsed), [
      { severity: "error", message: "ConfigError: no such file", location: undefined },
    ]);
  });

  it("gives nothing for output it could not read", () => {
    assert.deepEqual(problemsOf({ kind: "unparsable" }), []);
  });
});
