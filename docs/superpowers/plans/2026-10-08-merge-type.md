# Merge Commit Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `merge` as a Conventional Commits type in pi-commit-lint so hand-written merge commits (`merge: ...`) pass the linter.

**Architecture:** Single-constant change: append `merge` to the `TYPES` string in `lib/commit-lint.ts`; `SUBJECT_RE` (interpolated from `TYPES`) and the deny hint's legal-type list (derived via `TYPES.split("|")`) update automatically. Docs synced in README + CHANGELOG. No new logic branches.

**Tech Stack:** TypeScript (zero runtime deps), zero-dependency test runner (`test/run-all.sh`, esbuild bundle + node).

**Work from:** `/home/elling/git-repo/github/pi-commit-lint/.pi/worktrees/issue-1-merge-commit-type` (all paths below are relative to this worktree root).

## Global Constraints

- Typeset stays a single pipe-delimited string; final value verbatim: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge` (spec §设计-1).
- `Merge ...` (capital-M, git default format) subjects MUST still be blocked — pinned non-goal with a test case (spec §非目标).
- Deny hint example list (feat/fix/docs lines) MUST NOT change (spec §设计).
- Test verification command: `bash test/run-all.sh` from worktree root — exit 0 and `OK: 1/1 test files passed` required.
- Commit style: Conventional Commits, English messages, `git add` per file (no `git add -A`).

## Acceptance mapping

| Task | Spec IDs | Nature |
|---|---|---|
| Task 1 | A1 | automated (unit) |
| Task 2 | A2 | automated (static) |
| Task 3 | U1 | manual, post-merge/post-publish — tracked here, executed outside this plan's session |

---

### Task 1: Add `merge` to TYPES with test cases [A1]

**Files:**
- Modify: `lib/commit-lint.ts:7`
- Modify: `test/commit-lint.test.ts` (cases table + trailing checks)

**Interfaces:**
- Consumes: existing pure function `lintCommitCommand(command: string): string | null` (unchanged signature).
- Produces: same function now accepting `merge:`/`merge(scope):`/`merge!:` subjects; block hint whose legal-type line contains `merge / `.

- [ ] **Step 1: Write the failing tests**

In `test/commit-lint.test.ts`, inside the `cases` array, after the line:

```ts
	{ cmd: 'git commit -m "docs: 更新设计文档 (#5)"', expect: "pass", note: "issue ref" },
```

add these three rows:

```ts
	{ cmd: 'git commit -m "merge: integrate main into feature branch"', expect: "pass", note: "merge type (issue #1)" },
	{ cmd: 'git commit -m "merge(deps): merge main into scan"', expect: "pass", note: "merge with scope" },
	{ cmd: 'git commit -m "Merge branch \'main\' into feature"', expect: "block", note: "git default merge subject stays blocked (pinned non-goal)" },
```

Then, after the existing `hint echoes subject` check block, add:

```ts
// blocked hint must list merge in the legal types (derived from TYPES)
const mergeHint = lintCommitCommand('git commit -m "Merge branch \'main\' into x"');
check(
	"hint lists merge as legal type",
	mergeHint !== null && mergeHint.includes("revert / merge"),
	mergeHint === null ? "passed through" : "legal-type list missing merge",
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash test/run-all.sh`
Expected: FAIL — the two `merge:` pass-cases get blocked ("got hint: 🚫 ...") and/or `hint lists merge as legal type` fails. The `Merge branch` block-case and its new check-line pass trivially today (behavior already blocks); the red signal comes from the two pass-cases + the legal-type check.

- [ ] **Step 3: Minimal implementation**

In `lib/commit-lint.ts`, replace line 7:

```ts
const TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
```

with:

```ts
const TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash test/run-all.sh`
Expected: `OK: 1/1 test files passed` and `all 35 checks passed` (32 cases + 3 trailing checks: hint-echoes-subject, multiple--m, hint-lists-merge) — exit 0, zero FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add lib/commit-lint.ts test/commit-lint.test.ts
git commit -m "feat: allow merge as a commit type (issue #1)"
```

---

### Task 2: Sync README + CHANGELOG type lists [A2]

**Files:**
- Modify: `README.md` (two spots: deny-hint demo block ~L17, validation description ~L95)
- Modify: `CHANGELOG.md` (`[Unreleased]` section)

**Interfaces:**
- Consumes: final TYPES value from Task 1.
- Produces: docs consistent with implementation; no code impact.

- [ ] **Step 1: Update README legal-type demo line**

In `README.md`, replace:

```
合法 type: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert
```

with:

```
合法 type: feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert / merge
```

- [ ] **Step 2: Update README TYPES description**

In `README.md`, replace:

```
   `TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"`.
```

with:

```
   `TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge"`.
```

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, replace:

```markdown
## [Unreleased]

```

with:

```markdown
## [Unreleased]

### Added

- `merge` accepted as a commit type for hand-written merge commits
  (`merge: integrate main into feature branch`) — closes #1.
```

- [ ] **Step 4: Verify consistency (A2 static check)**

Run the three checks below (all from worktree root):

```bash
grep -nE 'revert(\|merge| / merge)' README.md lib/commit-lint.ts   # expect: README hits 2 lines, lib hits line 7
grep -n -A3 '### Added' CHANGELOG.md                                 # expect: Unreleased Added block mentioning merge, closes #1
grep -n 'chore|revert"' README.md lib/commit-lint.ts                # expect: no match (exit 1 = old pipe list gone)
```

Pass criteria: first two commands print the expected lines; third prints nothing.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: sync type lists with new merge type (issue #1)"
```

---

### Task 3: Post-publish manual verification [U1 — post-merge, outside this session]

**Files:** none (verification only; record results in the PR/issue thread).

**Interfaces:**
- Consumes: released npm package `@zhuxixi/pi-commit-lint` ≥ 0.2.0.

- [ ] **Step 1: Publish** — bump `version` to `0.2.0` in `package.json`, `npm publish --access=public` (npm root metadata has a few minutes of 404 lag; poll to 200).

- [ ] **Step 2: Update local install** — `pi install npm:@zhuxixi/pi-commit-lint`, then `/reload` in the live pi session.

- [ ] **Step 3: Positive check** — in a scratch git repo, run `git commit --allow-empty -m "merge: test subject"` through a pi bash call → must execute (not blocked).

- [ ] **Step 4: Negative check** — `git commit --allow-empty -m "update"` through a pi bash call → must be blocked with the 🚫 hint whose legal-type line includes `merge`.

- [ ] **Step 5: Record** — comment observed results on issue #1; only then mark U1 done (before that, U1 stays `pending` in the final report).
