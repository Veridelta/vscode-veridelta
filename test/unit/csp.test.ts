// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { makeNonce, withCsp } from "../../src/csp";

const CHARSET = '<meta charset="utf-8">';

const REPORT = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head>",
  CHARSET,
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>Veridelta report</title>",
  "<style>body { margin: 0; }</style>",
  "</head>",
  "<body>",
  "<main>Status: FAILED</main>",
  '<script>document.title = "Veridelta";</script>',
  "</body>",
  "</html>",
  "",
].join("\n");

describe("withCsp", () => {
  it("adds the policy after the charset meta and the nonce to the one style and the one script", () => {
    const nonce = "abc123+/=";
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`;
    const expected = REPORT.replace(CHARSET, `${CHARSET}\n${policy}`)
      .replace("<style>", `<style nonce="${nonce}">`)
      .replace("<script>", `<script nonce="${nonce}">`);
    assert.equal(withCsp(REPORT, nonce), expected);
  });

  it("refuses a document that is not the one Veridelta writes", () => {
    assert.throws(
      () => withCsp(REPORT.replace("</body>", "<script>1</script></body>"), "a"),
      /one <script> element/,
    );
    assert.throws(() => withCsp(REPORT.replace(/<style>.*<\/style>/, ""), "a"), /one <style> element/);
    assert.throws(() => withCsp(REPORT.replace(CHARSET, ""), "a"), /one charset meta/);
    assert.throws(
      () => withCsp(REPORT.replace("<script>", '<script src="x.js">'), "a"),
      /one <script> element/,
    );
  });

  it("refuses a nonce that is not base64", () => {
    assert.throws(() => withCsp(REPORT, "not base64"), /base64/);
  });
});

describe("makeNonce", () => {
  it("gives a fresh base64 value each time", () => {
    const first = makeNonce();
    const second = makeNonce();
    assert.match(first, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(first.length, 24);
    assert.notEqual(first, second);
  });
});
