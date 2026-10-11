# Veridelta for VS Code

Validate a [Veridelta](https://veridelta.github.io/veridelta/) configuration without leaving the editor. Each error and warning lands in the Problems panel, on the line that causes it.

## Install

The extension is not on the Marketplace yet. Download `vscode-veridelta-<version>.vsix` from the [latest release](https://github.com/Veridelta/vscode-veridelta/releases/latest) and install it:

```sh
code --install-extension vscode-veridelta-0.1.0.vsix
```

Or open the Extensions view, choose "Install from VSIX..." from its `...` menu, and pick the file. Every release is a pre-release until the Marketplace listing exists.

The extension runs the `veridelta` command, so [install Veridelta](https://veridelta.github.io/veridelta/#install) first. Veridelta 0.36.0 or later places each problem on its line. Veridelta 0.35.1 works too, with every problem on the first line.

## Use

Open a configuration file, such as `veridelta.yaml`, and run **Veridelta: Validate configuration** from the Command Palette. The Problems panel lists each finding with the source `veridelta`. Select one to jump to the setting it names. The command's own output, verdict included, is in the Output panel under "Veridelta".

A document with unsaved changes is saved first, because Veridelta reads the file from disk. The command runs in the file's folder, so relative paths in the configuration resolve as they do on the command line.

## Settings

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `veridelta.command` | `["veridelta"]` | The words that run Veridelta. A project that runs it through uv sets `["uv", "run", "veridelta"]`. On macOS the extension host's PATH can differ from a terminal's, and this setting is the fix. |

## Schema

With the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed, files named `veridelta*.yaml` get Veridelta's published schema: completion, hover text, and a mark on a misspelt key as you type. Without it, nothing changes.

## What comes next

A command that runs a comparison and opens its report, and registration of `veridelta mcp` with agent mode. The plan is in [issue 127](https://github.com/Veridelta/veridelta/issues/127) of the Veridelta repository.

## License

Apache 2.0. See `LICENSE` and `NOTICE`.
