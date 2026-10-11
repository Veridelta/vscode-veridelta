// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a run writes its discrepancy files, read from the configuration as written.
 *
 * Veridelta writes `added_rows`, `removed_rows`, and `changed_rows` under the
 * configuration's `output_path`, in its `output_format`, and skips an empty set.
 * A run compared where the data is stored writes the keys-only files and a
 * sample instead. The path is relative to the folder the command runs in,
 * which is the configuration's folder. This module imports nothing from VS
 * Code, so its tests run under plain Mocha.
 */

import * as path from "node:path";

import { parse } from "yaml";

import { isRecord } from "./output";

/** The formats `output_format` accepts. */
export const FORMATS = ["parquet", "csv", "json", "ndjson", "arrow"] as const;

export type ArtifactFormat = (typeof FORMATS)[number];

const TEXT_FORMATS: readonly ArtifactFormat[] = ["csv", "json", "ndjson"];

/** The names Veridelta gives discrepancy files: a local run's three, then pushdown's keys-only files and sample. */
const NAMES = [
  "added_rows",
  "removed_rows",
  "changed_rows",
  "added_rows_pks_only",
  "removed_rows_pks_only",
  "changed_rows_pks_only",
  "changed_rows_sample",
];

/** Where the files went and what they are. */
export interface ArtifactPlan {
  /** The output folder, resolved against the configuration's folder. */
  folder: string;
  format: ArtifactFormat;
  /** Whether the editor can open the files as text. */
  textual: boolean;
  /** The file names Veridelta may have written, in the order to open them. */
  candidates: string[];
}

function isFormat(value: unknown): value is ArtifactFormat {
  return typeof value === "string" && (FORMATS as readonly string[]).includes(value);
}

/**
 * Return the plan a configuration implies, or undefined when it names no `output_path`.
 *
 * @param configText The configuration file's text.
 * @param configFolder The folder the configuration is in, which the run ran in.
 */
export function artifactPlan(configText: string, configFolder: string): ArtifactPlan | undefined {
  let config: unknown;
  try {
    config = parse(configText);
  } catch {
    return undefined;
  }
  if (!isRecord(config) || typeof config.output_path !== "string" || config.output_path.length === 0) {
    return undefined;
  }
  const format = config.output_format === undefined ? "parquet" : config.output_format;
  if (!isFormat(format)) {
    return undefined;
  }
  return {
    folder: path.resolve(configFolder, config.output_path),
    format,
    textual: TEXT_FORMATS.includes(format),
    candidates: NAMES.map((name) => `${name}.${format}`),
  };
}
