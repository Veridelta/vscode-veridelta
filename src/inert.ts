// Copyright 2026 The Veridelta Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Text that a notification shows as it is, with no link a click would follow.
 */

/**
 * Break every markdown link in a message.
 *
 * VS Code reads `[label](target)` in a notification as a link, and a
 * `command:` target runs a command on one click. A space between `]` and `(`
 * keeps the words and stops the link, whatever the target's scheme.
 */
export function inert(message: string): string {
  return message.replace(/\]\(/g, "] (");
}
