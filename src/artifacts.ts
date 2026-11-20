// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a run writes its discrepancy files, read from the configuration as written.
 *
 * Veridelta writes `added_rows`, `removed_rows`, and `changed_rows` under the
 * configuration's `output_path`, in its `output_format`, and skips an empty set.
 * A run compared where the data is stored writes the keys-only files and a
 * sample instead. The path is relative to the folder the command runs in,
 * which is the configuration's folder.
 *
 * Only the two top-level settings are read, from the document tree as
 * Veridelta's YAML reader, PyYAML, would see them: the last of duplicate keys
 * wins, an alias is followed, and `<<` merge keys apply in PyYAML's order,
 * nested ones included. Nothing is expanded, so a file of nested anchors costs
 * no more than its text. This module imports nothing from VS Code, so its
 * tests run under plain Mocha.
 */

import * as path from "node:path";

import { isAlias, isMap, isScalar, isSeq, parseDocument, type Document, type YAMLMap } from "yaml";

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

/** The rows each kind of discrepancy file holds, as the run's summary counts them. */
export interface DifferenceCounts {
  added: number;
  removed: number;
  changed: number;
}

/**
 * The candidates a run with these counts can have written, in the order to open them.
 *
 * Veridelta skips an empty set, so a file for a kind the run counted none of
 * is left from an earlier run.
 */
export function candidatesFor(plan: ArtifactPlan, counts: DifferenceCounts): string[] {
  return plan.candidates.filter(
    (name) =>
      (name.startsWith("added_rows") && counts.added > 0) ||
      (name.startsWith("removed_rows") && counts.removed > 0) ||
      (name.startsWith("changed_rows") && counts.changed > 0),
  );
}

function isFormat(value: unknown): value is ArtifactFormat {
  return typeof value === "string" && (FORMATS as readonly string[]).includes(value);
}

/** When a file was last written and how big it was, enough to tell whether another run rewrote it. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

/** How much older than the run a file it wrote may look, for file systems that keep coarse times. */
export const CLOCK_SLACK_MS = 2000;

/** Whether a file was written since the run started, allowing for coarse file times. */
export function writtenSince(stamp: FileStamp, startedAt: number): boolean {
  return stamp.mtimeMs >= startedAt - CLOCK_SLACK_MS;
}

/** Whether a file is still as the run left it; false when it is gone or another run rewrote it. */
export function unchanged(then: FileStamp, now: FileStamp | undefined): boolean {
  return now?.mtimeMs === then.mtimeMs && now.size === then.size;
}

/**
 * Whether a path lies inside a folder, or is the folder.
 *
 * @param paths The path functions to use; Windows paths in a test pass `path.win32`.
 */
export function isInside(file: string, folder: string, paths: path.PlatformPath = path): boolean {
  const relative = paths.relative(folder, file);
  const outside = relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative);
  return !outside;
}

/** A node, with one alias followed. */
function resolved(document: Document, node: unknown): unknown {
  return isAlias(node) ? node.resolve(document) : node;
}

/** Whether a key is YAML's merge key: a plain `<<`, or the symbol the YAML 1.1 schema reads it as. */
function isMergeKey(key: unknown): boolean {
  if (!isScalar(key)) {
    return false;
  }
  const value: unknown = key.value;
  return value === "<<" || (typeof value === "symbol" && value.description === "<<");
}

/**
 * The mappings one `<<` value merges, in the order PyYAML lays their pairs down.
 *
 * A later pair wins, so in a list, whose first mapping wins, the order is reversed.
 */
function mergedMaps(document: Document, value: unknown): YAMLMap[] {
  const node = resolved(document, value);
  if (isMap(node)) {
    return [node];
  }
  if (isSeq(node)) {
    return node.items
      .map((item) => resolved(document, item))
      .filter((item): item is YAMLMap => isMap(item))
      .reverse();
  }
  return [];
}

/** No pair sets the key. */
const MISSING = Symbol("missing");

/**
 * A key's value node in a mapping, as PyYAML's merge flattening gives it.
 *
 * PyYAML lays down the pairs of each merged mapping, itself flattened the
 * same way, in the order of the `<<` keys, then the mapping's own pairs, and
 * the last pair with the key wins. So an own pair beats any merge, a later
 * `<<` beats an earlier one, and the last duplicate wins. Each mapping is
 * looked at once per key, so repeated aliases cost no more than the text,
 * and an alias loop ends.
 */
function lookup(document: Document, map: YAMLMap, key: string, seen: Map<YAMLMap, unknown>): unknown {
  if (seen.has(map)) {
    return seen.get(map);
  }
  // A mapping still being looked at merges itself: PyYAML fails there, and here it sets nothing.
  seen.set(map, MISSING);
  let found: unknown = MISSING;
  for (const pair of map.items) {
    if (isMergeKey(pair.key)) {
      for (const merged of mergedMaps(document, pair.value)) {
        const value = lookup(document, merged, key, seen);
        if (value !== MISSING) {
          found = value;
        }
      }
    }
  }
  for (const pair of map.items) {
    if (!isMergeKey(pair.key) && isScalar(pair.key) && pair.key.value === key) {
      found = pair.value;
    }
  }
  seen.set(map, found);
  return found;
}

/** A top-level setting's value, with merges and aliases followed as Veridelta's YAML reader follows them. */
function setting(document: Document, map: YAMLMap, key: string): unknown {
  const node = lookup(document, map, key, new Map());
  return node === MISSING ? undefined : scalarValue(resolved(document, node));
}

/** A scalar's value, or undefined for a mapping, a list, or nothing. */
function scalarValue(node: unknown): unknown {
  return isScalar(node) ? node.value : undefined;
}

/** What `planArtifacts` found: the plan, and whether the configuration could be read at all. */
export interface ArtifactRead {
  /** The plan, or undefined when the configuration names no `output_path` or could not be read. */
  plan: ArtifactPlan | undefined;
  /** False when the text is not YAML this reader follows, so the plan is unknown rather than absent. */
  readable: boolean;
}

/**
 * Read where a configuration sends its discrepancy files.
 *
 * @param configText The configuration file's text.
 * @param configFolder The folder the configuration is in, which the run ran in.
 */
export function planArtifacts(configText: string, configFolder: string): ArtifactRead {
  let document: Document;
  try {
    document = parseDocument(configText, { uniqueKeys: false });
  } catch {
    return { plan: undefined, readable: false };
  }
  if (document.errors.length > 0) {
    return { plan: undefined, readable: false };
  }
  const root = document.contents;
  if (!isMap(root)) {
    return { plan: undefined, readable: true };
  }
  const outputPath = setting(document, root, "output_path");
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    return { plan: undefined, readable: true };
  }
  const written = setting(document, root, "output_format");
  const format = written === undefined ? "parquet" : written;
  if (!isFormat(format)) {
    return { plan: undefined, readable: true };
  }
  return {
    plan: {
      folder: path.resolve(configFolder, outputPath),
      format,
      textual: TEXT_FORMATS.includes(format),
      candidates: NAMES.map((name) => `${name}.${format}`),
    },
    readable: true,
  };
}

/** Return the plan a configuration implies, or undefined when it names none or cannot be read. */
export function artifactPlan(configText: string, configFolder: string): ArtifactPlan | undefined {
  return planArtifacts(configText, configFolder).plan;
}
