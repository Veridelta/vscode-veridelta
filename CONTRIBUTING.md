# Contributing

Thanks for helping. This file says how the repository works. The rules that apply to every change, for people and for agents alike, are in `AGENTS.md`.

## Set up

You need Node 22 and a Veridelta on PATH, such as `uv tool install veridelta`.

```sh
npm ci
npm run check
npm test
```

`npm run check` lints, checks the formatting, and type checks. `npm test` runs the unit tests under Mocha, then the integration tests inside VS Code. The integration tests download a VS Code build into `.vscode-test/` the first time, open `test/fixtures/workspace/`, and run `veridelta` from PATH. On Linux without a display, run them under `xvfb-run -a npm test`.

Press F5 in VS Code to run the extension from source in a second window that opens the fixture workspace.

## Make a change

- One idea per pull request, with a title in the [Conventional Commits](https://www.conventionalcommits.org/) form, since the squash commit takes the title.
- Name the use case the change serves, such as `UC-01` in Veridelta's `product/USERS.md`, or say it is maintenance.
- Logic that needs nothing from VS Code lives in a module that imports nothing from VS Code, such as `src/report.ts`, and is tested under plain Mocha in `test/unit/`. Only the glue in `src/cli.ts`, `src/validate.ts`, and `src/extension.ts` touches the editor, and `test/integration/` covers it.
- Leave `CHANGELOG.md` and the version in `package.json` to the release pull request.

## Release

1. Open a pull request that sets the version with `npm version <version> --no-git-tag-version` and adds a `## v<version> (<date>)` section with one paragraph to `CHANGELOG.md`.
2. Merge it, then tag the merge commit: `git tag v<version> <sha>` and `git push origin v<version>`.
3. The Release workflow packages the `.vsix` and creates a GitHub pre-release with the changelog section as its notes. Until the Marketplace listing exists, the release page is where people install from.

Versions follow the Marketplace's pre-release convention, `major.ODD.patch`, so `0.1.x` for now.
