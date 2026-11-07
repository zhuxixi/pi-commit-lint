# Command-Segment Message Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the linter read the commit message from the `git commit` command segment instead of grabbing the first `-m` anywhere in the raw command string.

**Architecture:** Three new pure functions split the problem: `maskHeredocBodies` blanks text that a shell never executes (heredoc bodies, `#` comments), `splitCommandSegments` cuts the masked string on unquoted separators (`&&` `||` `;` `&` `|` newline), and `extractCommitMessage` tokenizes one segment and returns the first `-m`/`--message` value or `null`. `lintCommitCommand` becomes a thin loop over segments; `buildHint` gains the block source, the offending fragment and its position.

**Tech Stack:** TypeScript, zero runtime dependencies, zero-framework test runner (`test/run-all.sh`, esbuild bundle + node).

**Spec:** `docs/superpowers/specs/2026-11-07-command-segment-message-design.md`

**Work from:** `/home/elling/work/git-repo/pi-commit-lint/.pi/worktrees/issue-2-segment-message-lookup` (all paths below are relative to this worktree root).

## Global Constraints

- Type set stays verbatim: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge` (spec §非目标).
- Multiple `-m` on **one** commit keep the **first** (existing contract; do not reverse it).
- A commit segment with no message option (`-F`, `--file`, `--amend`, bare `git commit`) returns `null` from `extractCommitMessage` and is skipped — never borrow another segment's `-m`.
- Unparseable input fails **open**: when the scanner cannot tell, it must return `null` (pass), never block.
- `index.ts` wiring is unchanged; `package.json` is not touched in this PR.
- Comments and commit messages in English; user-facing hint text stays Chinese.
- Test command: `bash test/run-all.sh` from the worktree root; must exit 0.

## Review Focus

- `2>&1` — the `&` splitter cuts it in two; the commit segment must still carry the full message (Task 1 pins this).
- A heredoc whose body mentions `&& git commit -m "..."` — the single most common real-world false positive (Task 1 pins this).
- `#` inside a quoted subject (`"fix: #123"`) must not be treated as a comment (Task 1 pins this).
- `-Fmsg` / `-F /path` must not be mistaken for `-m` (Task 2 pins this).
- Two commits in one line where the first is legal and the second is not — the second must block (Task 3 pins this).

---

### Task 1: Heredoc/comment masking and segment splitting [A2, A3]

**Files:**
- Modify: `lib/commit-lint.ts` (add two exported functions, keep existing exports working)
- Create: `test/shell-parsing.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `maskHeredocBodies(command: string): string` (same-length string), `splitCommandSegments(masked: string): string[]` (non-empty segments, original quoting preserved).

- [ ] **Step 1: Write the failing test**

Create `test/shell-parsing.test.ts`:

```ts
/**
 * Unit tests for the shell-scanning helpers behind lintCommitCommand()
 * (issue #2). Each helper is pure: string in, string or string[] out.
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/shell-parsing.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/shell-parsing-test.mjs && node /tmp/shell-parsing-test.mjs
 */
import { maskHeredocBodies, splitCommandSegments } from "../lib/commit-lint";

let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// --- maskHeredocBodies: bodies are never executed, so they must be blanked ---

{
	const cmd = ["cat > /tmp/x.md <<'EOF'", 'python3 -m unittest && git commit -m "docs: x"', "EOF", "git commit -m \"fix: x\""].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("heredoc body is blanked (quoted delimiter)", !masked.includes("python3 -m unittest"), masked);
	check("text after the terminator survives", masked.includes('git commit -m "fix: x"'), masked);
	check("mask is length-preserving", masked.length === cmd.length, `${masked.length} !== ${cmd.length}`);
}

{
	const cmd = ["cat <<-EOF", "\tindented body", "\tEOF", "echo after"].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("<<- allows tab-indented terminator", !masked.includes("indented body") && masked.includes("echo after"), masked);
}

{
	const cmd = ["cat <<A <<B", "body a", "A", "body b", "B", "echo tail"].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("two heredocs on one line consume both bodies", !masked.includes("body a") && !masked.includes("body b") && masked.includes("echo tail"), masked);
}

{
	const cmd = ["cat <<EOF", "never closed", 'git commit -m "bad"'].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("unterminated heredoc swallows the rest (fail-open)", masked.trim() === "cat <<EOF", masked);
}

{
	const cmd = ['cat <<< "word"', 'git commit -m "feat: ok"'].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("herestring <<< does not start a heredoc body", masked.includes('git commit -m "feat: ok"'), masked);
}

{
	const cmd = ["ls -la # see && git commit -m \"update\"", 'git commit -m "fix: #123"', "echo a#b"].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("comment is blanked", !masked.includes('"update"'), masked);
	check("hash inside a quoted subject is kept", masked.includes("fix: #123"), masked);
	check("hash inside a word is kept", masked.includes("a#b"), masked);
}

{
	const cmd = ['echo "a << EOF"', 'git commit -m "feat: ok"'].join("\n");
	const masked = maskHeredocBodies(cmd);
	check("<< inside quotes is not a heredoc", masked.includes('git commit -m "feat: ok"'), masked);
}

// --- splitCommandSegments: only real command boundaries split ---

function segs(cmd: string): string[] {
	return splitCommandSegments(maskHeredocBodies(cmd)).map((s) => s.trim());
}

check("&& splits", segs('git add -A && git commit -m "x"').join("|") === 'git add -A|git commit -m "x"');
check("|| splits", segs("git pull || echo x").join("|") === "git pull|echo x");
check("; splits", segs("echo a; echo b").join("|") === "echo a|echo b");
check("| splits", segs("echo x | wc -l").join("|") === "echo x|wc -l");
check("newline splits", segs('git add -A\ngit commit -m "x"').join("|") === 'git add -A|git commit -m "x"');
check("separator inside quotes does not split", segs('git commit -m "a && b"').length === 1, segs('git commit -m "a && b"').join("|"));
check("blank heredoc leftover yields no empty segments", segs("echo a <<EOF\nx\nEOF").join("|") === "echo a <<EOF", segs("echo a <<EOF\nx\nEOF").join("|"));
check("empty input yields no segments", segs("").length === 0);

{
	const parts = splitCommandSegments('git commit -m "update" 2>&1').map((s) => s.trim());
	check("2>&1 is cut at & (harmless)", parts.length === 2 && parts[0].includes('"update"'), parts.join("|"));
}

if (failed) {
	console.error(`\n${failed} checks FAILED`);
	process.exit(1);
}
console.log("\nall shell-parsing checks passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash test/run-all.sh`
Expected: FAIL — the bundle errors with `No matching export in "lib/commit-lint.ts" for import "maskHeredocBodies"`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/commit-lint.ts` (below `lintCommitCommand`):

```ts
/**
 * Blank out the parts of a command string that a shell never executes:
 * heredoc bodies (including their terminator line) and `#` comments.
 * Length-preserving, so callers can still report original positions.
 *
 * Fail-open: an unterminated heredoc swallows the rest of the string, and an
 * unclosed quote leaves the remainder untouched — both end up as "not a
 * commit", never as a false block.
 */
export function maskHeredocBodies(command: string): string {
	const out = command.split("");
	const pending: Array<{ delim: string; stripTabs: boolean }> = [];
	let i = 0;
	let inSingle = false;
	let inDouble = false;

	while (i < command.length) {
		const c = command[i];

		if (inSingle) {
			if (c === "'") inSingle = false;
			i++;
			continue;
		}
		if (inDouble) {
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === '"') inDouble = false;
			i++;
			continue;
		}
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "'") {
			inSingle = true;
			i++;
			continue;
		}
		if (c === '"') {
			inDouble = true;
			i++;
			continue;
		}

		// `#` starts a comment only at the beginning of a word.
		if (c === "#" && (i === 0 || /[\s;&|()]/.test(command[i - 1]))) {
			while (i < command.length && command[i] !== "\n") {
				out[i] = " ";
				i++;
			}
			continue;
		}

		if (c === "<" && command[i + 1] === "<") {
			if (command[i + 2] === "<") {
				i += 3; // herestring: no body follows
				continue;
			}
			let j = i + 2;
			let stripTabs = false;
			if (command[j] === "-") {
				stripTabs = true;
				j++;
			}
			while (j < command.length && (command[j] === " " || command[j] === "\t")) j++;
			let delim = "";
			while (j < command.length) {
				const d = command[j];
				if (d === "'" || d === '"') {
					const quote = d;
					j++;
					while (j < command.length && command[j] !== quote) {
						if (quote === '"' && command[j] === "\\") {
							j++;
							if (j >= command.length) break;
						}
						delim += command[j];
						j++;
					}
					j++; // closing quote
					continue;
				}
				if (d === "\\") {
					j++;
					if (j < command.length) {
						delim += command[j];
						j++;
					}
					continue;
				}
				if (/[\s;&|<>()]/.test(d)) break;
				delim += d;
				j++;
			}
			if (delim) pending.push({ delim, stripTabs });
			i = j;
			continue;
		}

		if (c === "\n") {
			i++;
			for (const heredoc of pending) {
				const bodyStart = i;
				while (i < command.length) {
					let lineEnd = command.indexOf("\n", i);
					if (lineEnd === -1) lineEnd = command.length;
					let line = command.slice(i, lineEnd);
					if (heredoc.stripTabs) line = line.replace(/^\t+/, "");
					i = lineEnd < command.length ? lineEnd + 1 : lineEnd;
					if (line === heredoc.delim) break;
				}
				for (let k = bodyStart; k < i; k++) {
					if (command[k] !== "\n") out[k] = " ";
				}
			}
			pending.length = 0;
			continue;
		}

		i++;
	}

	return out.join("");
}

/**
 * Split a (already masked) command string into command segments on the
 * separators a shell honours: `&&`, `||`, `;`, `&`, `|` and newline.
 * Separators inside single/double quotes do not split.
 */
export function splitCommandSegments(masked: string): string[] {
	const segments: string[] = [];
	let start = 0;
	let i = 0;
	let inSingle = false;
	let inDouble = false;

	const push = (end: number) => {
		const segment = masked.slice(start, end);
		if (segment.trim() !== "") segments.push(segment);
	};

	while (i < masked.length) {
		const c = masked[i];

		if (inSingle) {
			if (c === "'") inSingle = false;
			i++;
			continue;
		}
		if (inDouble) {
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === '"') inDouble = false;
			i++;
			continue;
		}
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "'") {
			inSingle = true;
			i++;
			continue;
		}
		if (c === '"') {
			inDouble = true;
			i++;
			continue;
		}

		if (c === "&" || c === "|") {
			push(i);
			i += masked[i + 1] === c ? 2 : 1;
			start = i;
			continue;
		}
		if (c === ";" || c === "\n") {
			push(i);
			i++;
			start = i;
			continue;
		}

		i++;
	}

	push(masked.length);
	return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash test/run-all.sh`
Expected: PASS — `all shell-parsing checks passed`, and the existing `test/commit-lint.test.ts` still reports `all 35 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/commit-lint.ts test/shell-parsing.test.ts
git commit -m "feat(lint): mask heredoc bodies and comments, split command segments (#2)"
```

---

### Task 2: Token-aware message extraction [A4]

**Files:**
- Modify: `lib/commit-lint.ts` (add tokenizer + `extractCommitMessage`)
- Modify: `test/shell-parsing.test.ts` (import line + new assertion block)

**Interfaces:**
- Consumes: nothing from Task 1 (independent pure function).
- Produces: `extractCommitMessage(segment: string): string | null` — unquoted message text, `null` when the segment carries no `-m`/`--message`.

- [ ] **Step 1: Write the failing test**

First widen the import at the top of `test/shell-parsing.test.ts`:

```ts
import { extractCommitMessage, maskHeredocBodies, splitCommandSegments } from "../lib/commit-lint";
```

Then append to `test/shell-parsing.test.ts`, above the `if (failed)` block:

```ts
// --- extractCommitMessage: quote-aware, segment-local, first match wins ---

check("-m quoted", extractCommitMessage('git commit -m "x"') === "x");
check("-am cluster", extractCommitMessage('git commit -am "x"') === "x");
check("-qm cluster", extractCommitMessage('git commit -qm "x"') === "x");
check("--message space form", extractCommitMessage('git commit --message "x"') === "x");
check("--message= form", extractCommitMessage('git commit --message="x"') === "x");
check("-mfoo attached", extractCommitMessage("git commit -mfoo") === "foo");
check("escaped quotes unescape", extractCommitMessage('git commit -m "a \\"b\\" c"') === 'a "b" c');
check("multiple -m keep the first", extractCommitMessage('git commit -m "first" -m "second"') === "first");
check("-F only yields null", extractCommitMessage("git commit -F /tmp/msg.txt") === null);
check("-Fmsg is not -m", extractCommitMessage("git commit -Fmsg") === null);
check("--amend alone yields null", extractCommitMessage("git commit --amend") === null);
check("bare commit yields null", extractCommitMessage("git commit") === null);
check("-m without a value yields null", extractCommitMessage("git commit -m") === null);
check("empty -m keeps empty string", extractCommitMessage('git commit -m ""') === "");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash test/run-all.sh`
Expected: FAIL — bundle error `No matching export ... "extractCommitMessage"`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/commit-lint.ts`:

```ts
interface ShellToken {
	/** Value with quotes removed and escapes resolved. */
	value: string;
}

/** Minimal shell word splitter: whitespace-separated, quote-aware. */
function tokenizeSegment(segment: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let i = 0;

	while (i < segment.length) {
		while (i < segment.length && /\s/.test(segment[i])) i++;
		if (i >= segment.length) break;
		let value = "";

		while (i < segment.length && !/\s/.test(segment[i])) {
			const c = segment[i];
			if (c === "'") {
				i++;
				while (i < segment.length && segment[i] !== "'") {
					value += segment[i];
					i++;
				}
				i++;
				continue;
			}
			if (c === '"') {
				i++;
				while (i < segment.length && segment[i] !== '"') {
					if (segment[i] === "\\" && i + 1 < segment.length) {
						const next = segment[i + 1];
						if (next === '"' || next === "\\" || next === "$" || next === "`") {
							value += next;
							i += 2;
							continue;
						}
					}
					value += segment[i];
					i++;
				}
				i++;
				continue;
			}
			if (c === "\\" && i + 1 < segment.length) {
				value += segment[i + 1];
				i += 2;
				continue;
			}
			value += c;
			i++;
		}

		tokens.push({ value });
	}

	return tokens;
}

/**
 * First `-m`/`-am`/`-qm`/`--message`/`--message=`/`-mfoo` value in a segment.
 * Returns null when the segment carries no message option (`-F`, `--file`,
 * `--amend`, bare `git commit`) — the caller must then pass through.
 */
export function extractCommitMessage(segment: string): string | null {
	const tokens = tokenizeSegment(segment);

	for (let i = 0; i < tokens.length; i++) {
		const value = tokens[i].value;
		const next = () => (i + 1 < tokens.length ? tokens[i + 1].value : null);

		if (value === "-m" || value === "--message") return next();
		if (/^-[A-Za-z]+m$/.test(value)) return next();
		if (value.startsWith("--message=")) return value.slice("--message=".length);
		if (value.startsWith("-m") && value.length > 2) return value.slice(2);
	}

	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash test/run-all.sh`
Expected: PASS — both test files green.

- [ ] **Step 5: Commit**

```bash
git add lib/commit-lint.ts test/shell-parsing.test.ts
git commit -m "feat(lint): extract commit message from tokens, not raw regex (#2)"
```

---

### Task 3: Segment-scoped lint, hint source and position [A1, A5]

**Files:**
- Modify: `lib/commit-lint.ts` (`buildHint` signature + `lintCommitCommand` body + drop `MSG_RE`/`COMMIT_RE`)
- Modify: `test/commit-lint.test.ts` (10 new cases + 4 new trailing checks)

**Interfaces:**
- Consumes: `maskHeredocBodies`, `splitCommandSegments` (Task 1), `extractCommitMessage` (Task 2).
- Produces: `lintCommitCommand(command: string): string | null` — same signature, new semantics; hint text now contains `来源:` and `检测到的命令片段 (n/m):`.

- [ ] **Step 1: Write the failing test**

In `test/commit-lint.test.ts`, append to the `cases` array (before the closing `];`):

```ts
	// --- issue #2: the message must come from the commit segment ---
	{ cmd: 'python3 -m unittest test_x -v && git commit -m "fix: real subject"', expect: "pass", note: "issue #2 A: earlier -m is not the commit message" },
	{ cmd: `cat > /tmp/x.md <<'EOF'\npython3 -m unittest test_x -v && git commit -m "docs: 示例"\nEOF`, expect: "pass", note: "issue #2 B: heredoc body is not executed" },
	{ cmd: "git add a.py && git commit -q -F /tmp/msg.txt && git log --oneline -1 && python3 -m unittest test_x", expect: "pass", note: "issue #2 C1: -F message, no -m in the segment" },
	{ cmd: 'python3 -m unittest test_a test_b 2>&1 | tail -2 && git add -A && git commit -q -m "fix(cr): round 1"', expect: "pass", note: "issue #2 C2: unittest before commit" },
	{ cmd: 'git stash push a.yml b.yml -m "暂存两份改动" && git add -A && git commit -F /tmp/commitmsg.txt', expect: "pass", note: "issue #2 D: stash -m is not the commit message" },
	{ cmd: 'git stash push a.yml -m "stash msg" && git commit -m "fix(deploy): 修复超时"', expect: "pass", note: "issue #2 D2: conforming commit after stash -m" },
	{ cmd: 'git commit -F /tmp/msg.txt && git stash push -m "wip"', expect: "pass", note: "issue #2 E: -m after the commit belongs to stash" },
	{ cmd: 'git add -A\ngit commit -m "update"', expect: "block", note: "newline is a separator (was a false negative)" },
	{ cmd: 'ls -la # see && git commit -m "update"', expect: "pass", note: "issue #2 H: # comment is not executed" },
	{ cmd: 'git commit -m "feat: ok" && git commit -m "bad"', expect: "block", note: "second commit segment decides when the first conforms" },
```

Then append at the end of the file (before the final `if (failed)` block), and update the summary line at the very bottom from `${cases.length + 3}` to `${cases.length + 7}` (four new trailing checks land in this task):

```ts
// blocked hint must name the blocking source (issue #2: downstream users
// burned hours hunting for a repo git hook that never existed)
const sourceHint = lintCommitCommand('git commit -m "update"');
check(
	"hint names the extension as the source",
	sourceHint !== null && sourceHint.includes("pi 扩展") && sourceHint.includes("@zhuxixi/pi-commit-lint"),
	sourceHint === null ? "passed through" : "source line missing",
);

// ... and echo the detected fragment with its position among the segments
check(
	"hint echoes fragment and position",
	sourceHint !== null && sourceHint.includes("检测到的命令片段 (1/1)") && sourceHint.includes('git commit -m "update"'),
	sourceHint === null ? "passed through" : "fragment line missing",
);

// multi-segment command: the offending segment is reported as 2/2
const multiHint = lintCommitCommand('git commit -m "feat: ok" && git commit -m "bad"');
check(
	"multi-segment position",
	multiHint !== null && multiHint.includes("(2/2)"),
	multiHint === null ? "passed through" : "position missing",
);

// long fragments are truncated so the hint stays readable
const longHint = lintCommitCommand(`git commit -m "update ${"x".repeat(200)}"`);
check(
	"long fragment truncated",
	longHint !== null && longHint.includes("已截断"),
	longHint === null ? "passed through" : "truncation marker missing",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash test/run-all.sh`
Expected: FAIL — issue #2 A/B/C1/... rows report `pass -> block` style failures, and the new hint checks fail.

- [ ] **Step 3: Write minimal implementation**

Replace, in `lib/commit-lint.ts`, the `MSG_RE`/`COMMIT_RE` constants, `buildHint` and `lintCommitCommand` with:

```ts
// A commit invocation must be the whole segment, not a quoted mention.
const COMMIT_SEGMENT_RE = /^\s*git\s+commit\b/;
const FRAGMENT_LIMIT = 160;

function buildHint(subject: string, fragment: string, position: number, total: number): string {
	const flat = fragment.replace(/\s+/g, " ").trim();
	const shown = flat.length > FRAGMENT_LIMIT ? `${flat.slice(0, FRAGMENT_LIMIT)}…（已截断）` : flat;

	return [
		"🚫 commit message 不符合 Conventional Commits，已阻止提交。",
		"",
		"来源: pi 扩展 @zhuxixi/pi-commit-lint（不是仓库的 git hook，也不在 core.hooksPath 里）",
		`检测到的命令片段 (${position}/${total}): ${shown}`,
		`当前 subject: ${JSON.stringify(subject)}`,
		"要求格式: type(scope)?: 描述",
		`合法 type: ${TYPES.split("|").join(" / ")}`,
		"",
		"示例:",
		"  feat(scan): 新增整页 OCR",
		"  fix(qa): 修复离散采样越界",
		"  docs: 更新设计文档 (#5)",
		"",
		"提示: 消息来自 -F/--file 文件或编辑器时本扩展不拦截；把提交拆成单独一次 bash 调用可避免片段混淆。",
		"",
		"请改成规范格式后重新提交。",
	].join("\n");
}

/**
 * Returns a block reason if `command` contains a non-conforming
 * `git commit -m` segment, else null (pass through). Pure function.
 *
 * The message is read from the segment that owns the `git commit`, never
 * from the whole string: a `-m` in `python3 -m unittest` or in a
 * `git stash push -m` is not a commit message (issue #2).
 */
export function lintCommitCommand(command: string): string | null {
	const segments = splitCommandSegments(maskHeredocBodies(command));

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (!COMMIT_SEGMENT_RE.test(segment)) continue;

		const message = extractCommitMessage(segment);
		if (message === null) continue; // -F / editor commit: nothing to judge

		const subject = message.trim().split("\n", 1)[0].trim();
		if (SUBJECT_RE.test(subject)) continue;

		return buildHint(subject, segment.trim(), i + 1, segments.length);
	}

	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash test/run-all.sh`
Expected: PASS — `commit-lint.test.ts` reports `all 50 checks passed` (40 cases + 10 trailing checks across both files counted per file), `shell-parsing.test.ts` green, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/commit-lint.ts test/commit-lint.test.ts
git commit -m "fix(lint): read commit message from the commit segment only (#2)"
```

---

### Task 4: Documentation and changelog [A6, A7]

**Files:**
- Modify: `README.md` (Features bullet, How It Works, Troubleshooting, new Limitations section)
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Fixed`)

**Interfaces:**
- Consumes: behaviour and wording from Tasks 1–3 (no code change).
- Produces: docs that match the implementation, including the `## Limitations` heading A6 greps for.

- [ ] **Step 1: Write the failing check**

Run (from worktree root):

```bash
grep -F 'The first `-m`/`-am`/`--message` value is extracted' README.md; echo "old-anchor rc=$?"
grep -F '## Limitations' README.md; echo "limitations rc=$?"
grep -n 'Unreleased' -A6 CHANGELOG.md
```

Expected: old-anchor rc=0 (stale sentence still present), limitations rc=1 (section missing), CHANGELOG has no `#2` entry.

- [ ] **Step 2: Update README**

Replace the second Features bullet (the "No false positives on git detection" bullet) with:

```markdown
- **Segment-scoped message lookup**: the command is first stripped of text a
  shell never executes (heredoc bodies, `#` comments), then split into
  command segments (`&&` `||` `;` `&` `|` newline). Only the `git commit`
  segment is asked for its message, so `python3 -m unittest … && git commit
  -m "fix: x"` and `git commit -F msg.txt && git stash push -m "wip"` are
  judged on the real message. A commit with no message option (`-F`,
  `--file`, `--amend`) passes through.
```

Replace step 2–3 of "How It Works" with:

```markdown
2. Text a shell never executes is blanked first: heredoc bodies
   (`<<EOF`, `<<-EOF`, quoted delimiters) and `#` comments. Blanking is
   length-preserving, so reported positions stay accurate.
3. The remaining string is split into command segments on unquoted
   separators: `&&`, `||`, `;`, `&`, `|`, newline. Quotes protect their
   contents, so `-m "a && b"` stays one segment.
4. Every segment starting with `git commit` is inspected on its own. The
   first `-m` / `-am` / `-qm` / `--message` / `--message=` / `-mfoo` value
   in that segment is the subject (multiple `-m` keep the first). A
   segment with no message option is skipped — `-F` / `--file` message
   files are not read.
```

Renumber the remaining steps (the `SUBJECT_RE` check becomes 5, the block
becomes 6), and add a Limitations section before `## License`:

```markdown
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
```

In Troubleshooting, replace the "A commit was blocked unexpectedly" entry with:

```markdown
- **A commit was blocked unexpectedly**: read the hint's first lines. `来源:`
  names this extension (it is not a repo git hook), and `检测到的命令片段
  (n/m)` shows exactly which segment was judged — check that the message in
  that segment really is the one you meant to commit.
```

- [ ] **Step 3: Update CHANGELOG**

Under `## [Unreleased]`, add:

```markdown
### Fixed

- Commit messages are now read from the `git commit` command segment, not
  from the first `-m` anywhere in the command string. Fixes false blocks on
  chained commands, heredoc bodies, `#` comments and `-F`/stash messages,
  and catches newline-separated commits that used to slip through (#2).
- Block hints now name the blocking extension and echo the detected command
  fragment with its segment position (#2).
```

- [ ] **Step 4: Run checks to verify they pass**

Run:

```bash
grep -F 'The first `-m`/`-am`/`--message` value is extracted' README.md; echo "old-anchor rc=$?"
grep -F '## Limitations' README.md; echo "limitations rc=$?"
grep -n 'Unreleased' -A8 CHANGELOG.md
bash test/run-all.sh
```

Expected: `old-anchor rc=1`, `limitations rc=0`, CHANGELOG shows the `#2` entry, tests still exit 0.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe segment-scoped lookup and its limits (#2)"
```

---

## Acceptance mapping

| Task | Spec IDs |
|---|---|
| Task 1 | A2, A3 |
| Task 2 | A4 |
| Task 3 | A1, A5 |
| Task 4 | A6, A7 |

U1 (post-release real-machine check) and U2 (JFox note) are post-merge manual steps, tracked in the spec — not tasks in this plan.
