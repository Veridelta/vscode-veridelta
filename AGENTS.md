# Working on Veridelta for VS Code

This is the VS Code extension for [Veridelta](https://github.com/Veridelta/veridelta). It runs the `veridelta` command line and shows what it printed. It decides nothing about data itself: the verdict, the findings, and their places all come from Veridelta.

## Layout

| Path | Holds |
| :--- | :--- |
| `src/report.ts`, `src/locate.ts`, `src/version.ts` | Logic that imports nothing from VS Code, tested under plain Mocha in `test/unit/`. |
| `src/cli.ts`, `src/validate.ts`, `src/extension.ts` | The glue to the editor: the setting, the process, the command, the Problems panel. `test/integration/` runs it inside VS Code on `test/fixtures/workspace/`. |
| `dist/extension.js` | The esbuild bundle that ships. `out/` is the TypeScript output the tests run. Neither is committed. |
| `.github/workflows/ci.yml` | Checks, tests on three operating systems, the `.vsix` artifact, and the one gate job `CI Passed`. |
| `.github/workflows/release.yml` | On a `v*` tag: the `.vsix` on a GitHub pre-release. |

## Commands

`npm ci`, `npm run check`, `npm test`, `npm run package`. On Linux without a display, `xvfb-run -a npm test`.

## Rules

- One idea per pull request. The title follows Conventional Commits, and the summary names the use case or says it is maintenance.
- `CHANGELOG.md` and the version in `package.json` change only in a release pull request.
- A release pull request sets the version and the changelog. On merge, the Release workflow tags `main` `v<version>` and attaches the `.vsix` to a GitHub pre-release. Nothing is published to the Marketplace yet.
- Every `.ts` and `.mjs` file starts with the copyright and SPDX lines the others carry.
- Never commit a model id, an email address, or a credential.
- Writing, in code comments and documents alike: no dashes, sentence case, short sentences, present tense, no marketing words.
- Pin every dependency to one version and every GitHub Action to a commit SHA with its tag in a comment. No `${{` inside a workflow's `run` script; pass values through `env`.
