# pi-commit-lint

[![npm version](https://img.shields.io/npm/v/@zhuxixi/pi-commit-lint)](https://www.npmjs.com/package/@zhuxixi/pi-commit-lint)
[![license](https://img.shields.io/github/license/zhuxixi/pi-commit-lint)](./LICENSE)
[![pi package](https://img.shields.io/badge/pi-package-181717?logo=github)](https://pi.dev/packages)

Conventional Commits lint for [pi](https://github.com/earendil-works/pi-coding-agent):
blocks non-conforming `git commit -m ...` commands run through the `bash`
tool and returns a corrective hint to the model. A port of the Claude Code
`PreToolUse` hook (`~/.claude/scripts/commit_lint.py`).

```text
🚫 commit message 不符合 Conventional Commits，已阻止提交。

当前 subject: "update stuff"
要求格式: type(scope)?: 描述
合法 type: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert / merge

示例:
  feat(scan): 新增整页 OCR
  fix(qa): 修复离散采样越界
  docs: 更新设计文档 (#5)

请改成规范格式后重新提交。
```

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [How It Works](#how-it-works)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [License](#license)

## Features

- **Blocks non-conforming commits**: a `git commit -m ...` whose subject
  does not match Conventional Commits is blocked at the tool call; the
  block reason is the corrective hint, sent back to the model so it can
  retry with a valid message.
- **Segment-scoped message lookup**: the command is first stripped of text a
  shell never executes (heredoc bodies, `#` comments), then split into
  command segments (`&&` `||` `;` `&` `|` newline). Only the `git commit`
  segment is asked for its message, so `python3 -m unittest … && git commit
  -m "fix: x"` and `git commit -F msg.txt && git stash push -m "wip"` are
  judged on the real message. A commit with no message option (`-F`,
  `--file`, `--amend`) passes through.
- **Only `-m` commits are intercepted**: editor/heredoc commits
  (no `-m`/`-am`/`--message`) pass through untouched.
- **Zero dependencies beyond pi**: the validation logic is a pure
  function in `lib/commit-lint.ts`, unit-tested without a test framework.

## Requirements

- **pi ≥ 0.84** (uses the `tool_call` event). No other dependencies.

## Installation

### From npm (recommended)

```bash
pi install npm:@zhuxixi/pi-commit-lint
```

Then run `/reload` in pi (no restart needed).

To update later:

```bash
pi update --extensions
```

To remove:

```bash
pi remove npm:@zhuxixi/pi-commit-lint
```

### From source

Clone the repository into a subdirectory of pi's global extensions dir:

```bash
git clone https://github.com/zhuxixi/pi-commit-lint.git ~/.pi/agent/extensions/pi-commit-lint
```

## How It Works

1. On the `tool_call` event, non-`bash` calls are ignored.
2. Text a shell never executes is blanked first: heredoc bodies
   (`<<EOF`, `<<-EOF`, quoted delimiters) and `#` comments, so a commit
   command quoted inside documentation prose is not judged as one.
3. The remaining string is split into command segments on unquoted
   separators: `&&`, `||`, `;`, `&`, `|`, newline. Quotes protect their
   contents, so `-m "a && b"` stays one segment.
4. Every segment starting with `git commit` is inspected on its own. The
   first `-m` / `-am` / `-qm` / `--message` / `--message=` / `-mfoo` value
   in that segment is the subject (multiple `-m` keep the first). A
   segment with no message option is skipped — `-F` / `--file` message
   files are not read.
5. The subject is checked against `^(TYPES)(\([\w./-]+\))?!?: .+` with
   `TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge"`.
6. Non-conforming subjects are blocked with `{ block: true, reason }`,
   where `reason` is a Chinese corrective hint.

No configuration, no commands, no state files — it just works.

## Development

```bash
./test/run-all.sh   # bundles test/*.test.ts with esbuild and runs them
```

Tests are dependency-free: `lib/commit-lint.ts` is pure and covered by
positive/negative cases (subject conformance, `-m` extraction, git-commit
detection without false positives).

After editing, run `/reload` inside pi to hot-reload the extension.

## Troubleshooting

- **Commits aren't blocked**: check that the extension is listed in
  `pi config`; after install you must `/reload` (or restart) pi for the
  extension to load.
- **A commit was blocked unexpectedly**: read the hint's first lines. `来源:`
  names this extension (it is not a repo git hook), and `检测到的命令片段
  (n/m)` shows exactly which segment was judged — check that the message in
  that segment really is the one you meant to commit.
- **Editor/heredoc commits**: these are intentionally not intercepted.

## Limitations

- `-F` / `--file` message files are **not** read or validated; such commits
  pass through. The file may not exist yet when the tool call is intercepted.
- `git -C <dir> commit`, environment-prefixed invocations (`VAR=x git commit`)
  and subshell forms (`(git commit …)`) are not recognised — they pass
  through unvalidated.
- This is a minimal shell scanner, not a shell parser: command substitution
  (`$(…)`, backticks) and process substitution are treated as opaque text.
  Anything the scanner cannot classify fails open (the command is allowed).
- The check runs on the `tool_call` event, before the command executes; it is
  not a git hook. A blocked command never runs, so side effects earlier in
  the same chain do not happen either.

## License

[MIT](./LICENSE)
