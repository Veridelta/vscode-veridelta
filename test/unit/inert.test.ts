// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

import * as assert from "node:assert/strict";

import { inert } from "../../src/inert";

/** VS Code's pattern for a link in a notification, from its linkedText parser. */
const LINK = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)(\3))?\)/i;

/** Any markdown link, whatever its scheme, so a parser that takes more schemes stays covered. */
const ANY_LINK = /\[[^\]]*\]\(/;

describe("inert", () => {
  it("breaks a command link from the data", () => {
    const message =
      "The columns read are: '[Open](command:workbench.action.terminal.new)', 'status', 'amount'.";
    assert.match(message, LINK);
    const shown = inert(message);
    assert.doesNotMatch(shown, LINK);
    assert.doesNotMatch(shown, ANY_LINK);
    assert.match(shown, /command:workbench\.action\.terminal\.new/, "the words stay");
  });

  it("breaks every link, whatever the scheme", () => {
    for (const target of [
      "command:x",
      "file:///etc/passwd",
      "https://example.com",
      "vscode://x",
      "other:x",
    ]) {
      assert.doesNotMatch(inert(`see [here](${target}) and [there](${target} "t")`), ANY_LINK, target);
    }
  });

  it("breaks links that sit next to each other or nest", () => {
    for (const message of [
      "[a](command:x)[b](command:y)",
      "[[a](command:x)](command:y)",
      "[a]((command:x))",
      "](",
    ]) {
      assert.doesNotMatch(inert(message), ANY_LINK, message);
    }
  });

  it("leaves text with no link as it is", () => {
    for (const message of [
      "Veridelta: the run of veridelta.yaml was cancelled.",
      "Values [1, 2] differ (by 3).",
      "",
    ]) {
      assert.equal(inert(message), message);
    }
  });
});
