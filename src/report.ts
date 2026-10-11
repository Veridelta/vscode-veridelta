// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What `veridelta validate --json` prints, and the problems the editor shows for it.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 * The shapes follow the published schema at
 * https://veridelta.github.io/veridelta/schema/validate.schema.json and the error
 * object every command prints at exit code 3.
 */

import { isRecord, parseJson, readErrorReport, type ErrorReport } from "./output";

/** One step of a path into the configuration: a key, or an index into a list. */
export type Step = string | number;

/** Where in the file a finding points. Lines and columns count from 1. */
export interface FindingLocation {
  path?: Step[];
  line?: number;
  column?: number;
  message?: string;
}

/** One error or warning, with where it points. Veridelta 0.36.0 adds `locations`. */
export interface Finding {
  severity: "error" | "warning";
  message: string;
  locations: FindingLocation[];
}

/** The object `veridelta validate --json` prints at exit code 0 or 1. */
export interface ValidationReport {
  config: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  findings?: Finding[];
}

/** The command's output, read by its exit code. */
export type Parsed =
  | { kind: "report"; report: ValidationReport }
  | { kind: "error"; error: ErrorReport }
  | { kind: "unparsable" };

/** A problem to show, placed by a location the editor resolves later. */
export interface Problem {
  severity: "error" | "warning";
  message: string;
  location: FindingLocation | undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStepArray(value: unknown): value is Step[] {
  return Array.isArray(value) && value.every((step) => typeof step === "string" || typeof step === "number");
}

/** Read one location, keeping the fields this extension knows and dropping the rest. */
function readLocation(value: unknown): FindingLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const location: FindingLocation = {};
  if (isStepArray(value.path)) {
    location.path = value.path;
  }
  if (typeof value.line === "number") {
    location.line = value.line;
  }
  if (typeof value.column === "number") {
    location.column = value.column;
  }
  if (typeof value.message === "string") {
    location.message = value.message;
  }
  return location;
}

function readFinding(value: unknown): Finding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { severity, message, locations } = value;
  if (
    (severity !== "error" && severity !== "warning") ||
    typeof message !== "string" ||
    !Array.isArray(locations)
  ) {
    return undefined;
  }
  const items: unknown[] = locations;
  const read: FindingLocation[] = [];
  for (const item of items) {
    const location = readLocation(item);
    if (location === undefined) {
      return undefined;
    }
    read.push(location);
  }
  return { severity, message, locations: read };
}

/**
 * Read the command's stdout by its exit code.
 *
 * Exit 0 and 1 print the report, exit 3 the error object, and anything else is
 * not JSON this extension knows. A report without `findings`, from a Veridelta
 * before 0.36.0, still reads.
 */
export function parseOutput(stdout: string, code: number | null): Parsed {
  const value = parseJson(stdout);
  if (code === 3) {
    const error = readErrorReport(value);
    return error === undefined ? { kind: "unparsable" } : { kind: "error", error };
  }
  if ((code !== 0 && code !== 1) || !isRecord(value)) {
    return { kind: "unparsable" };
  }
  const { config, valid, errors, warnings, findings } = value;
  if (
    typeof config !== "string" ||
    typeof valid !== "boolean" ||
    !isStringArray(errors) ||
    !isStringArray(warnings)
  ) {
    return { kind: "unparsable" };
  }
  const report: ValidationReport = { config, valid, errors, warnings };
  if (findings === undefined) {
    return { kind: "report", report };
  }
  if (!Array.isArray(findings)) {
    return { kind: "unparsable" };
  }
  const items: unknown[] = findings;
  const read: Finding[] = [];
  for (const item of items) {
    const finding = readFinding(item);
    if (finding === undefined) {
      return { kind: "unparsable" };
    }
    read.push(finding);
  }
  report.findings = read;
  return { kind: "report", report };
}

/** The message for one location: its own message behind its path, as Veridelta's text output names it. */
function messageAt(finding: Finding, location: FindingLocation): string {
  if (location.message === undefined) {
    return finding.message;
  }
  if (location.path === undefined || location.path.length === 0) {
    return location.message;
  }
  return `[${location.path.join(" -> ")}]: ${location.message}`;
}

/**
 * Turn what the command printed into the problems the editor shows.
 *
 * A finding with locations gives one problem per location, each with that
 * location's own message when it has one, so a validation failure that bundles
 * two typos becomes two problems on two lines. A finding without a location,
 * or a report from a Veridelta without `findings`, gives one problem that the
 * editor places on the first line. An error object becomes one error problem
 * named by its type.
 */
export function problemsOf(parsed: Parsed): Problem[] {
  if (parsed.kind === "unparsable") {
    return [];
  }
  if (parsed.kind === "error") {
    const { type, message } = parsed.error;
    return [{ severity: "error", message: `${type}: ${message}`, location: undefined }];
  }
  const { report } = parsed;
  if (report.findings === undefined) {
    const errors: Problem[] = report.errors.map((message) => ({
      severity: "error",
      message,
      location: undefined,
    }));
    const warnings: Problem[] = report.warnings.map((message) => ({
      severity: "warning",
      message,
      location: undefined,
    }));
    return [...errors, ...warnings];
  }
  return report.findings.flatMap((finding): Problem[] => {
    if (finding.locations.length === 0) {
      return [{ severity: finding.severity, message: finding.message, location: undefined }];
    }
    return finding.locations.map((location) => ({
      severity: finding.severity,
      message: messageAt(finding, location),
      location,
    }));
  });
}
