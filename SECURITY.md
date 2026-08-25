# Security Policy

## Reporting a Vulnerability

If you find a security issue in pi-commit-lint, please report it
privately instead of opening a public issue:

- **Email:** <zhuzhenxi_555@hotmail.com> — put `pi-commit-lint security`
  in the subject line.

Please include a description of the issue, affected versions, and (if
possible) steps to reproduce. I will acknowledge your report within 7
days and aim to publish a fix within 30 days of confirmation.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Scope

The extension inspects `git commit` commands in pi's `tool_call` event
and returns block hints; it never executes git itself and never reads
files outside the tool event. Security concerns would primarily be:
regex logic in `lib/commit-lint.ts` (block bypass via exotic quoting or
separators) or the hint text (injection into the model context). When
reporting, please note which area is involved.
