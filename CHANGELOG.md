# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `merge` accepted as a commit type for hand-written merge commits
  (`merge: integrate main into feature branch`) — closes #1.

## [0.1.0] - 2026-08-26

First public release — split out of `pi-personal-extensions` (was
`commit-lint.ts`), published to npm as `@zhuxixi/pi-commit-lint`.

### Added

- `tool_call` interception: non-conforming `git commit -m ...` commands
  run through the bash tool are blocked with a Chinese corrective hint
  returned to the model.
- False-positive-safe git detection: `git commit` must start the command
  or follow a command separator (`&&` `||` `;` `&` `|`).
- `-m`/`-am`/`--message` subject extraction (first match wins);
  editor/heredoc commits pass through.
- `lib/commit-lint.ts`: dependency-free pure validator
  (`lintCommitCommand`) with 31 positive/negative test cases.
- Zero-dependency test runner (`test/run-all.sh`, esbuild + node).
- `package.json` pi manifest so the extension installs via
  `pi install npm:@zhuxixi/pi-commit-lint`.
