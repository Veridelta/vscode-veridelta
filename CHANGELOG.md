# Changelog

## v0.1.3 (2026-11-28)

This release hardens the extension after a security review, and readies it for Open VSX
under the name "Veridelta: Data Diff", with Veridelta's logo as its icon. Error
notifications break any link in their text, and Veridelta's error also goes to the
Veridelta output. The agent settings `veridelta.mcp.allowRowValues`,
`veridelta.mcp.allowQueries`, `veridelta.mcp.maxRows`, and `veridelta.mcp.env` apply from
user settings only, so values in a workspace's settings are ignored, and `maxRows` is held
to 1000. The new setting `veridelta.mcp.allowHosts` names the hosts the agent's tools may
reach, passed only to a Veridelta that takes `--allow-host`, with one warning for
Veridelta 0.42.2. Agent mode skips missing folders. Validate shows progress and can be
cancelled, a newer validate of a file replaces an older one, and Cancel ends the whole
process tree. Each run writes its own report, and the extension keeps the five newest for
each configuration, none past a week. Open discrepancy files opens only this run's files,
opens large files, and follows no link out of the workspace. The report's policy also
allows images embedded as `data:` URLs, and forbids forms and `<base>`. The extension
declares that it does not run in untrusted or virtual workspaces. Releases attach
`SHA256SUMS` and a build provenance attestation.

## v0.1.2 (2026-10-11)

The extension registers `veridelta mcp` with VS Code's agent mode: one server, Veridelta,
started with one `--root` per workspace folder and run in the first, so an agent in the
Chat view gets Veridelta's six tools and reads nothing outside the workspace. The settings
`veridelta.mcp.allowRowValues`, `veridelta.mcp.allowQueries`, and `veridelta.mcp.maxRows`
map onto the server's flags and restart it when they change. Resolving the server fills in
the installed Veridelta's version.

## v0.1.1 (2026-10-11)

The command **Veridelta: Run comparison** runs the configuration in the active editor, or
one picked from the workspace, with `veridelta run --json --html` in the file's folder,
behind a progress notification that can cancel it. The verdict arrives as a notification
whose buttons open the HTML report in an editor tab, behind a Content Security Policy that
allows exactly the report's one style and one script, open the discrepancy files the
configuration's `output_path` names (CSV, JSON, and NDJSON as text, Parquet and Arrow in
the Explorer), or show the command's output. The report is written under the extension's
storage, so the workspace stays clean. The `veridelta.run.htmlMaxRows` setting passes
`--html-max-rows`.

## v0.1.0 (2026-10-11)

The first pre-release. The command **Veridelta: Validate configuration** runs
`veridelta validate --json` on the open file and shows each finding in the Problems panel:
on the line it points to with Veridelta 0.36.0 or later, and on the first line with an
older Veridelta. The `veridelta.command` setting names the words that run Veridelta, such
as `["uv", "run", "veridelta"]`. Files named `veridelta*.yaml` get the published schema
when the YAML extension is installed. Continuous integration checks and tests the
extension on Linux, macOS, and Windows and builds the `.vsix`, and a tag `v<version>`
attaches it to a GitHub pre-release.
