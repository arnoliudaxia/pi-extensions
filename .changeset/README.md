# Changesets

Each pending Markdown file records a user-visible change to Presets Plus for the
next release. This is a single-package repository; the package name in the
frontmatter remains `@sherif-fanous/pi-presets-plus`.

## Add a changeset

Prefer `mise run changeset` from the repository root. This task uses the
official Changesets CLI. If mise is unavailable, run the same CLI directly:

```shell
pnpm exec changeset add
```

Choose `patch` for fixes and `minor` for new features. Breaking changes also use
`minor` while the version is below 1.0.0. Alternatively, create a Markdown file
here with YAML frontmatter and a user-facing summary:

```markdown
---
"@sherif-fanous/pi-presets-plus": minor
---

- Changed: **Breaking:** Install Presets Plus from the repository root instead
  of `packages/pi-presets-plus`
```

Write concise, actionable summaries. Existing `Added:`, `Changed:`, `Removed:`,
and `Fixed:` bullets can stay, but the official CLI does not require or strip
these prefixes. Mark a breaking change and explain what users must do. Tests,
internal refactors, and tooling-only changes do not need a changeset.

## Version and release

Versioning and publishing require maintainer approval. The maintainer can run:

```shell
mise run changeset-check
mise run version
```

Without mise, the equivalent commands are `pnpm exec changeset status` and
`pnpm exec changeset version`.

`version` consumes the pending changesets, updates the package version, and
writes changelog entries using the official default `@changesets/cli/changelog`.
The former private release tooling is gone: this workflow does not generate
Common Changelog sections or enforce the old group prefix rules. Preserve all
previously released `CHANGELOG.md` entries, and review the generated diff and
refresh the lockfile with `pnpm install` before committing a version update.

Neither adding a changeset nor running `version` publishes the package. There is
no automatic release to the original npm scope. The retained `@sherif-fanous`
name is not publishing authorization: the maintainer must choose the release
destination and have the appropriate registry permissions and credentials before
any publish operation. Git and local installs of this fork do not depend on an
npm release.
