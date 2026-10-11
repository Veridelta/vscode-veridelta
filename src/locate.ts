// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Place a finding's location in the document's text.
 *
 * A location with a line and column, which a parse error carries, lands on that
 * line. One with a path of keys and indexes lands on the setting the path names,
 * read with the `yaml` package so the placement follows the document as written.
 * A setting with a plain value is underlined from its key to the end of its value,
 * so a wrong value and a misspelt key both show where they are. A setting whose
 * value is a block is underlined at its key. A missing setting lands on the block
 * that should hold it, and a list item on its first line. A path the document does
 * not hold lands on the first line. This module imports nothing from VS Code, so
 * its tests run under plain Mocha.
 */

import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { Document, Node, Pair } from "yaml";

import type { FindingLocation, Step } from "./report";

/** A position in the document, counted from 0 as VS Code counts. */
export interface Position {
  line: number;
  character: number;
}

/** A span in the document. */
export interface Range {
  start: Position;
  end: Position;
}

/** A span as offsets into the text. */
interface Span {
  start: number;
  end: number;
}

/** The offset at which the line holding `offset` ends, before any carriage return. */
function endOfLine(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  const end = newline === -1 ? text.length : newline;
  return end > offset && text[end - 1] === "\r" ? end - 1 : end;
}

/** The whole first line, where a problem the text cannot place is shown. */
export function firstLine(text: string): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: endOfLine(text, 0) } };
}

/** A line counted from 1, from a column counted from 1 to the line's end. */
function lineRange(text: string, line: number, column: number | undefined): Range {
  const lines = text.split("\n");
  const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
  const content = lines[index] ?? "";
  const length = content.endsWith("\r") ? content.length - 1 : content.length;
  const character = Math.min(Math.max((column ?? 1) - 1, 0), length);
  return { start: { line: index, character }, end: { line: index, character: length } };
}

/** A scalar's whole span; a block's first line, from where it starts. */
function nodeSpan(text: string, node: Node): Span | undefined {
  if (!node.range) {
    return undefined;
  }
  const [start, valueEnd] = node.range;
  return isScalar(node) ? { start, end: valueEnd } : { start, end: endOfLine(text, start) };
}

/** A setting's span: the key through a plain value on the same line, else the key alone. */
function pairSpan(text: string, pair: Pair): Span | undefined {
  const key = isNode(pair.key) ? nodeSpan(text, pair.key) : undefined;
  if (key === undefined) {
    return undefined;
  }
  const { value } = pair;
  if (!isScalar(value) || !value.range) {
    return key;
  }
  const lineEnd = endOfLine(text, key.start);
  if (value.range[0] >= lineEnd) {
    return nodeSpan(text, value) ?? key;
  }
  return { start: key.start, end: Math.min(value.range[1], lineEnd) };
}

/** The entry one step below a parent: a map's pair by key, or a list's item by index. */
function stepInto(parent: unknown, step: Step): { pair: Pair } | { node: Node } | undefined {
  if (isMap(parent)) {
    const wanted = String(step);
    const pair = parent.items.find((item) => isScalar(item.key) && String(item.key.value) === wanted);
    return pair === undefined ? undefined : { pair };
  }
  if (isSeq(parent) && typeof step === "number") {
    const item: unknown = parent.items[step];
    return isNode(item) ? { node: item } : undefined;
  }
  return undefined;
}

/** The span a path names, else the span of the deepest setting on the path the document holds. */
function place(text: string, document: Document, path: Step[]): Span | undefined {
  const step = path.at(-1);
  if (step === undefined) {
    return undefined;
  }
  const parentPath = path.slice(0, -1);
  const parent: unknown = parentPath.length === 0 ? document.contents : document.getIn(parentPath, true);
  const found = stepInto(parent, step);
  if (found === undefined) {
    return place(text, document, parentPath);
  }
  return "pair" in found ? pairSpan(text, found.pair) : nodeSpan(text, found.node);
}

/** The position of an offset, counted from 0. */
function toPosition(counter: LineCounter, offset: number): Position {
  const { line, col } = counter.linePos(offset);
  return { line: line - 1, character: col - 1 };
}

function pathRange(text: string, path: Step[]): Range | undefined {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  const span = place(text, document, path);
  if (span === undefined) {
    return undefined;
  }
  return { start: toPosition(lineCounter, span.start), end: toPosition(lineCounter, span.end) };
}

/**
 * Return where in the text a finding's location points.
 *
 * @param text The document's text.
 * @param location A location from `findings`, or undefined for a problem the text does not place.
 */
export function rangeFor(text: string, location: FindingLocation | undefined): Range {
  if (location === undefined) {
    return firstLine(text);
  }
  if (location.line !== undefined) {
    return lineRange(text, location.line, location.column);
  }
  if (location.path !== undefined) {
    try {
      return pathRange(text, location.path) ?? firstLine(text);
    } catch {
      return firstLine(text);
    }
  }
  return firstLine(text);
}
