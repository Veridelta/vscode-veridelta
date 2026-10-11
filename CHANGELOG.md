# Changelog

## v0.1.0 (2026-10-11)

The first pre-release. The command **Veridelta: Validate configuration** runs
`veridelta validate --json` on the open file and shows each finding in the Problems panel:
on the line it points to with Veridelta 0.36.0 or later, and on the first line with an
older Veridelta. The `veridelta.command` setting names the words that run Veridelta, such
as `["uv", "run", "veridelta"]`. Files named `veridelta*.yaml` get the published schema
when the YAML extension is installed. Continuous integration checks and tests the
extension on Linux, macOS, and Windows and builds the `.vsix`, and a tag `v<version>`
attaches it to a GitHub pre-release.
