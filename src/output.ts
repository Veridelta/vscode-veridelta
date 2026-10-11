// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Readers shared by every command's JSON output.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 */

/** The object every command prints at exit code 3. */
export interface ErrorReport {
  type: string;
  message: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse stdout as JSON, or undefined when it is not JSON. */
export function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

/** Read the `{"error": {"type", "message"}}` object, or undefined when the value is not one. */
export function readErrorReport(value: unknown): ErrorReport | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  const { type, message } = value.error;
  return typeof type === "string" && typeof message === "string" ? { type, message } : undefined;
}
