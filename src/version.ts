// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Read and compare Veridelta's version, as `veridelta --version` prints it.
 *
 * This module imports nothing from VS Code, so its tests run under plain Mocha.
 */

/** Three numbers: major, minor, patch. */
export type Version = [number, number, number];

/** The oldest Veridelta whose `validate --json` this extension reads. */
export const MINIMUM_VERSION = "0.35.1";

/** The first Veridelta that places each finding in the file, which the Problems panel needs. */
export const LOCATIONS_VERSION = "0.36.0";

/** Read `veridelta 0.36.0`, or `0.36.0`, into its three numbers; anything else is undefined. */
export function parseVersion(text: string): Version | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Say whether a version is at least a floor, each as text holding `major.minor.patch`. */
export function isAtLeast(version: string, floor: string): boolean {
  const have = parseVersion(version);
  const need = parseVersion(floor);
  if (have === undefined || need === undefined) {
    return false;
  }
  const pairs: [number, number][] = [
    [have[0], need[0]],
    [have[1], need[1]],
    [have[2], need[2]],
  ];
  for (const [ours, theirs] of pairs) {
    if (ours !== theirs) {
      return ours > theirs;
    }
  }
  return true;
}
