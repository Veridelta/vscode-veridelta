# Changelog

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
