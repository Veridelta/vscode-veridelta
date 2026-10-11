// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A Content Security Policy for the HTML report, so a webview runs its one script and style and nothing else.
 *
 * Veridelta's report is one document with exactly one bare `<style>`, one bare
 * `<script>`, and one charset meta, and it loads nothing from anywhere; a test
 * in Veridelta's repository holds it to that. This module imports nothing from
 * VS Code, so its tests run under plain Mocha.
 */

import { randomBytes } from "node:crypto";

const CHARSET = '<meta charset="utf-8">';

/** A fresh nonce for one webview, as base64. */
export function makeNonce(): string {
  return randomBytes(16).toString("base64");
}

function occurrences(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/**
 * Return the report with a policy that allows exactly its own style and script.
 *
 * Throws when the document is not the one Veridelta writes, so a report this
 * extension does not understand is never shown with a policy that fits it badly.
 */
export function withCsp(html: string, nonce: string): string {
  if (!/^[A-Za-z0-9+/]+=*$/.test(nonce)) {
    throw new Error("The nonce must be base64.");
  }
  const missing: string[] = [];
  if (occurrences(html, /<style\b/g) !== 1 || !html.includes("<style>")) {
    missing.push("one <style> element");
  }
  if (occurrences(html, /<script\b/g) !== 1 || !html.includes("<script>")) {
    missing.push("one <script> element");
  }
  if (occurrences(html, /<meta charset=/g) !== 1 || !html.includes(CHARSET)) {
    missing.push("one charset meta");
  }
  if (missing.length > 0) {
    throw new Error(`The report is not the document Veridelta writes. It needs ${missing.join(", ")}.`);
  }
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`;
  return html
    .replace(CHARSET, `${CHARSET}\n${policy}`)
    .replace("<style>", `<style nonce="${nonce}">`)
    .replace("<script>", `<script nonce="${nonce}">`);
}
