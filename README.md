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
- [License](#license)

## Features

- **Blocks non-conforming commits**: a `git commit -m ...` whose subject
  does not match Conventional Commits is blocked at the tool call; the
  block reason is the corrective hint, sent back to the model so it can
  retry with a valid message.
- **No false positives on git detection**: `git commit` must start the
  command or follow a command separator (`&&` `||` `;` `&` `|`), so
  quoted text, heredoc bodies and grep patterns mentioning `git commit`
  never trigger (the CC original matched anywhere and false-positived
  twice in one session).
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
2. The command is matched against `COMMIT_RE` — `git commit` at the
   start of the command or right after a separator.
3. The first `-m`/`-am`/`--message` value is extracted as the subject
   (double/single quotes or a bare word; multiple `-m` keep the first).
4. The subject is checked against `^(TYPES)(\([\w./-]+\))?!?: .+` with
   `TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge"`.
5. Non-conforming subjects are blocked with `{ block: true, reason }`,
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
- **A commit was blocked unexpectedly**: the subject must include a
  valid type prefix and a non-empty description after the colon; check
  for missing space or wrong separator (a comma between type and scope
  instead of parentheses).
- **Editor/heredoc commits**: these are intentionally not intercepted.

## License

[MIT](./LICENSE)
