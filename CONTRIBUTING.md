# Contributing

Presets Plus is the only package in this fork. Run commands from the repository
root, not the former `packages/pi-presets-plus` directory.

## Setup

Use [mise](https://mise.jdx.dev/) for the tool versions and tasks declared in
`mise.toml`. With Node and pnpm available, install dependencies:

```shell
pnpm install
```

If mise is available, `mise install` provisions the declared tools. The
extension loads TypeScript directly in Pi; no build step is needed.

## Tasks

Prefer the repository's mise tasks:

```shell
mise run check       # formatting, types, lint, tests, changeset status
mise run test-watch  # tests in watch mode
mise run format      # fix formatting
mise run lint-fix    # fix most lint violations
```

`mise.toml` has the rest. If mise cannot be installed or run, including on a
Windows setup where installation fails, use the equivalent local commands:

```shell
pnpm exec sort-package-json --check package.json
pnpm exec prettier --check .
pnpm exec tsc --noEmit
pnpm exec eslint src/. tests/.
pnpm exec vitest --run
pnpm exec changeset status
```

All checks must pass. For fixes, replace Prettier's `--check` with `--write` or
add `--fix` to ESLint; use `pnpm exec vitest` for watch mode. These commands use
installed project dependencies and do not require changing user settings.

## Planning

Behavior changes are planned as
[OpenSpec](https://github.com/Fission-AI/OpenSpec) changes under
`openspec/changes/`. A small fix does not need one. Run OpenSpec from the
repository root, which now holds the Presets Plus specs and change history.

## Before you open a pull request

1. `mise run check` passes, or all equivalent checks above pass when mise is
   unavailable.
2. New behavior has a test. Reuse the helpers in `tests/support/`, copied from
   the former private testing package. Runtime helpers remain the npm dependency
   `@sherif-fanous/pi-extensions-core` at `0.1.0`.
3. If the work has an OpenSpec change, its tasks are checked off and
   `openspec validate "<name>"` passes.
4. Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org/).
5. The change follows [AGENTS.md](AGENTS.md), including text, configuration, and
   UI conventions that linters do not enforce.
6. A change users can see has a changeset. See
   [.changeset/README.md](.changeset/README.md) for the official CLI workflow.
7. Keep the original author credit, MIT license, and released `CHANGELOG.md`
   entries intact.

## Versions and publishing

Adding a changeset does not publish anything. Versioning and publishing are
maintainer operations; do not run them without approval. This fork retains the
original npm package name for compatibility, but that does not grant permission
to publish to `@sherif-fanous`. A maintainer must decide the release destination
and have the required credentials and registry permissions. See
[.changeset/README.md](.changeset/README.md) for versioning details.
