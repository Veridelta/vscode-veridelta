# Veridelta for VS Code

Validate a [Veridelta](https://veridelta.github.io/veridelta/) configuration, run its comparison, and hand `veridelta mcp` to agent mode without leaving the editor. Each error and warning lands in the Problems panel, on the line that causes it; a run ends in a verdict with the report and the discrepancy files one click away; and an agent in the Chat view gets Veridelta's tools, held to the workspace's folders.

## Install

The extension is not on the Marketplace yet. Download `vscode-veridelta-<version>.vsix` from the newest release on the [Releases page](https://github.com/Veridelta/vscode-veridelta/releases) and install it:

```sh
code --install-extension vscode-veridelta-<version>.vsix
```

Or open the Extensions view, choose "Install from VSIX..." from its `...` menu, and pick the file. Every release is a pre-release until the Marketplace listing exists.

VS Code installs a `.vsix` without checking who built it. Releases after 0.1.2 carry a `SHA256SUMS` file and a build provenance attestation, so you can check that the release workflow built the file for its tag, with the GitHub CLI:

```sh
gh attestation verify vscode-veridelta-<version>.vsix -R Veridelta/vscode-veridelta \
  --cert-identity https://github.com/Veridelta/vscode-veridelta/.github/workflows/release.yml@refs/tags/v<version> \
  --deny-self-hosted-runners
```

The extension runs the `veridelta` command, so [install Veridelta](https://veridelta.github.io/veridelta/#install) first. Veridelta 0.36.0 or later places each problem on its line. Veridelta 0.35.1 works too, with every problem on the first line. Agent mode also needs Veridelta's `mcp` extra: `uv tool install 'veridelta[mcp]'`, or `uv add 'veridelta[mcp]'` in a project that runs Veridelta through `uv run`.

## Validate a configuration

Open a configuration file, such as `veridelta.yaml`, and run **Veridelta: Validate configuration** from the Command Palette. The Problems panel lists each finding with the source `veridelta`. Select one to jump to the setting it names. The command's own output, verdict included, is in the Output panel under "Veridelta".

A document with unsaved changes is saved first, because Veridelta reads the file from disk. The command runs in the file's folder, so relative paths in the configuration resolve as they do on the command line. A progress notification can cancel it, and a validate that gives no result clears the file's problems, so the panel never shows problems from an older version of the file.

## Run a comparison

Run **Veridelta: Run comparison** from the Command Palette. It takes the configuration in the active editor, or asks which `veridelta*.yaml` in the workspace to run, then runs `veridelta run --json --html` in the file's folder behind a progress notification you can cancel. The verdict arrives as a notification, such as `Veridelta: FAILED. Added 1, removed 1, changed 1.`, with three buttons: open the HTML report in an editor tab, open the discrepancy files the configuration's `output_path` names, or show the command's output.

The report is written under the extension's storage, so the workspace stays clean. Each run writes its own report, so an earlier notification still opens that run's report. A report holds rows from the data, up to `veridelta.run.htmlMaxRows` per table, so the extension keeps the five newest reports for each configuration, counting the new one, and before each run removes any report in this workspace older than a week. The discrepancy files go where the configuration says, as on the command line. CSV, JSON, and NDJSON open as text; Parquet and Arrow are shown in the Explorer with a hint naming `output_format: csv`. A configuration without `output_path` writes no discrepancy files, and the button says so. The button opens only the files this run wrote, while they are as it left them: files an earlier run left in the folder stay closed, and once a later run rewrites them, the earlier notification says so instead of opening the later run's rows.

## Agent mode

The extension registers `veridelta mcp` as an MCP server with VS Code's agent mode, so an agent in the Chat view can validate a configuration, run a comparison, and read the rows that differ through the six tools the [AI agents](https://veridelta.github.io/veridelta/agents/) page lists. The server starts with one `--root` per workspace folder that exists, runs in the first, and reads nothing outside them. It appears as "Veridelta" under **MCP: List Servers**. With `veridelta.command` set to `uv run`, the server finds the uv project from the first folder, where Validate and Run find it from the configuration's folder.

Five settings shape the server: `veridelta.mcp.allowRowValues`, `veridelta.mcp.allowQueries`, `veridelta.mcp.allowHosts`, `veridelta.mcp.maxRows`, and `veridelta.mcp.env`. They apply from user settings alone, so a workspace's settings cannot set them. In a dev container, though, the repository's `devcontainer.json` can write the Remote settings. The server also runs the program `veridelta.command` names, and a trusted workspace can set that setting to a wrapper that passes the server any flag, so these limits hold only for a command you chose. In a remote window, such as a dev container or WSL, set them in the Remote settings. A change stops the running server, and the next tool call starts it with the new settings. A session in Copilot's Agent Host picks the change up at its next message, and a change made while the extension was not running reaches it once the extension starts.

Row values stay off until you turn them on, so the tools return no rows. Column names come from the files as their configurations' reader options read them. A tool reads data on this machine only, until `veridelta.mcp.allowHosts` names the database servers, buckets, or other hosts it may connect to. Both holds need a Veridelta release after 0.42.2. With 0.42.2, a tool can connect to any host a configuration names, and a database error can quote a value from the data. 0.42.2 also refuses `--allow-host`, so with it the extension leaves the hosts out and says so once. The extension keeps a definite answer about whether the installed Veridelta takes `--allow-host` for the window, so after you upgrade Veridelta, reload the window.

VS Code's agent sandbox treats this server by harness. In the default Copilot harness with `chat.agent.sandbox.enabled` on, the server runs inside the sandbox, which must be able to read Veridelta's install, such as `~/.local/share/uv/tools` for a uv tool install, through `chat.agent.sandbox.fileSystem.userConfiguredPaths`. In the Local harness it runs outside the sandbox, since VS Code gives a server an extension registers no way to opt in.

## Settings

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `veridelta.command` | `["veridelta"]` | The words that run Veridelta. A project that runs it through uv sets `["uv", "run", "veridelta"]`. On macOS the extension host's PATH can differ from a terminal's, and this setting is the fix. It names a program to run, so the extension stays off until you trust the workspace. |
| `veridelta.run.htmlMaxRows` | unset | Rows per table in the HTML report, passed as `--html-max-rows`. Unset, Veridelta's default of 1000 applies. |
| `veridelta.mcp.allowRowValues` | `false` | Let the agent's tools return values from the data, as `--allow-row-values` does. User settings only. |
| `veridelta.mcp.allowQueries` | `false` | Let a tool run a side's query as written, as `--allow-queries` does. User settings only. |
| `veridelta.mcp.allowHosts` | `[]` | Hosts the agent's tools may connect to, each passed as `--allow-host`, in lowercase with no scheme or port, such as `db.internal`. User settings only. Needs a Veridelta after 0.42.2. |
| `veridelta.mcp.env` | `{}` | Variables for the agent's server: a string sets one, and `null` removes one the editor's environment holds, such as one Veridelta refuses to start with. A `PATH` value is added to the end of the inherited `PATH`. User settings only. |
| `veridelta.mcp.maxRows` | `50` | The most rows, or value map entries, one tool call returns, as `--max-rows` sets it, up to 1000. User settings only. |

## Schema

With the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) installed, files named `veridelta*.yaml` get Veridelta's published schema: completion, hover text, and a mark on a misspelt key as you type. Without it, nothing changes.

## License

Apache 2.0. See `LICENSE` and `NOTICE`.
