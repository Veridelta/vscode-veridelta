// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What `veridelta run --json` prints: the summary fields the editor shows.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 * The shape follows https://veridelta.github.io/veridelta/schema/run.schema.json.
 */

import { isRecord, parseJson, readErrorReport, type ErrorReport } from "./output";

/** The verdict and the counts of one run. */
export interface RunSummary {
  isMatch: boolean;
  added: number;
  removed: number;
  changed: number;
  /** Rows a baseline accepted, 0 without one. */
  accepted: number;
  /** The text summary the command prints without `--json`. */
  reportSummary: string;
}

/** The command's output, read by its exit code. */
export type RunParsed =
  { kind: "summary"; summary: RunSummary } | { kind: "error"; error: ErrorReport } | { kind: "unparsable" };

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Read the command's stdout by its exit code.
 *
 * Exit 0 (a match) and 1 (drift) print the summary, exit 3 the error object,
 * and anything else is not JSON this extension knows.
 */
export function parseRunOutput(stdout: string, code: number | null): RunParsed {
  const value = parseJson(stdout);
  if (code === 3) {
    const error = readErrorReport(value);
    return error === undefined ? { kind: "unparsable" } : { kind: "error", error };
  }
  if ((code !== 0 && code !== 1) || !isRecord(value)) {
    return { kind: "unparsable" };
  }
  const added = count(value.added_count);
  const removed = count(value.removed_count);
  const changed = count(value.changed_count);
  const accepted = value.accepted_count === undefined ? 0 : count(value.accepted_count);
  if (
    typeof value.is_match !== "boolean" ||
    typeof value.report_summary !== "string" ||
    added === undefined ||
    removed === undefined ||
    changed === undefined ||
    accepted === undefined
  ) {
    return { kind: "unparsable" };
  }
  return {
    kind: "summary",
    summary: {
      isMatch: value.is_match,
      added,
      removed,
      changed,
      accepted,
      reportSummary: value.report_summary,
    },
  };
}

/** The one line the notification shows: the verdict and the counts. */
export function verdictLine(summary: RunSummary): string {
  const verdict = summary.isMatch ? "PASSED" : "FAILED";
  const counts = `Added ${String(summary.added)}, removed ${String(summary.removed)}, changed ${String(summary.changed)}`;
  const accepted = summary.accepted > 0 ? `, ${String(summary.accepted)} accepted` : "";
  return `Veridelta: ${verdict}. ${counts}${accepted}.`;
}
