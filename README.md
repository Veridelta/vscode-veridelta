# Veridelta for VS Code

Validate a [Veridelta](https://veridelta.github.io/veridelta/) configuration and run its comparison without leaving the editor. Each error and warning lands in the Problems panel, on the line that causes it, and a run ends in a verdict with the report and the discrepancy files one click away.

## Install

The extension is not on the Marketplace yet. Download `vscode-veridelta-<version>.vsix` from the [latest release](https://github.com/Veridelta/vscode-veridelta/releases/latest) and install it:

```sh
code --install-extension vscode-veridelta-0.1.0.vsix
```

Or open the Extensions view, choose "Install from VSIX..." from its `...` menu, and pick the file. Every release is a pre-release until the Marketplace listing exists.

The extension runs the `veridelta` command, so [install Veridelta](https://veridelta.github.io/veridelta/#install) first. Veridelta 0.36.0 or later places each problem on its line. Veridelta 0.35.1 works too, with every problem on the first line.

## Validate a configuration

Open a configuration file, such as `veridelta.yaml`, and run **Veridelta: Validate configuration** from the Command Palette. The Problems panel lists each finding with the source `veridelta`. Select one to jump to the setting it names. The command's own output, verdict included, is in the Output panel under "Veridelta".

A document with unsaved changes is saved first, because Veridelta reads the file from disk. The command runs in the file's folder, so relative paths in the configuration resolve as they do on the command line.

## Run a comparison

Run **Veridelta: Run comparison** from the Command Palette. It takes the configuration in the active editor, or asks which `veridelta*.yaml` in the workspace to run, then runs `veridelta run --json --html` in the file's folder behind a progress notification you can cancel. The verdict arrives as a notification, such as `Veridelta: FAILED. Added 1, removed 1, changed 1.`, with three buttons: open the HTML report in an editor tab, open the discrepancy files the configuration's `output_path` names, or show the command's output.

The report is written under the extension's storage, so the workspace stays clean. The discrepancy files go where the configuration says, as on the command line. CSV, JSON, and NDJSON open as text; Parquet and Arrow are shown in the Explorer with a hint naming `output_format: csv`. A configuration without `output_path` writes no discrepancy files, and the button says so.

## Settings

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `veridelta.command` | `["veridelta"]` | The words that run Veridelta. A project that runs it through uv sets `["uv", "run", "veridelta"]`. On macOS the extension host's PATH can differ from a terminal's, and this setting is the fix. |
| `veridelta.run.htmlMaxRows` | unset | Rows per table in the HTML report, passed as `--html-max-rows`. Unset, Veridelta's default of 1000 applies. |

## Schema

With the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed, files named `veridelta*.yaml` get Veridelta's published schema: completion, hover text, and a mark on a misspelt key as you type. Without it, nothing changes.

## What comes next

Registration of `veridelta mcp` with agent mode. The plan is in [issue 127](https://github.com/Veridelta/veridelta/issues/127) of the Veridelta repository.

## License

Apache 2.0. See `LICENSE` and `NOTICE`.
