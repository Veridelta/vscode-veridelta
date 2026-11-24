// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Which stored reports to remove: each run writes its own, and old ones go.
 *
 * A report holds rows from the data, so before each run the extension
 * removes the configuration's reports past the newest few, and any report in
 * the workspace's storage older than a week. This module imports nothing
 * from VS Code, so its tests run under plain Mocha.
 */

/** How many reports to keep for one configuration. */
export const KEEP_PER_CONFIGURATION = 5;

/** How long a report is kept at most. */
export const KEEP_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/** A stored report: its file name and when it was written. */
export interface ReportEntry {
  name: string;
  mtimeMs: number;
}

/**
 * Return the names of the reports to remove.
 *
 * @param entries The files in the reports folder.
 * @param prefix The name prefix of the configuration just run; its reports past the newest few go.
 * @param now The time now, in milliseconds since the epoch.
 * @param keep How many of that configuration's reports to keep.
 */
export function reportsToRemove(
  entries: readonly ReportEntry[],
  prefix: string,
  now: number,
  keep = KEEP_PER_CONFIGURATION,
): string[] {
  const reports = entries.filter((entry) => entry.name.endsWith(".html"));
  const old = reports.filter((entry) => now - entry.mtimeMs > KEEP_FOR_MS);
  const surplus = reports
    .filter((entry) => entry.name.startsWith(prefix))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(keep);
  return [...new Set([...old, ...surplus].map((entry) => entry.name))].sort();
}
