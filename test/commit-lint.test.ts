/**
 * Positive/negative cases for lintCommitCommand() — issue #6.
 * Covers Conventional Commits conformance (SUBJECT_RE), -m extraction
 * (extractCommitMessage), and segment-scoped git-commit detection
 * (splitCommandSegments + COMMIT_SEGMENT_RE, issue #2).
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/commit-lint.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/commit-lint-test.mjs && node /tmp/commit-lint-test.mjs
 */
import { lintCommitCommand } from "../lib/commit-lint";

// expect: "pass" = returns null (allowed), "block" = returns a corrective hint
const cases: Array<{ cmd: string; expect: "pass" | "block"; note?: string }> = [
	// --- conforming messages pass ---
	{ cmd: 'git commit -m "feat: add OCR"', expect: "pass" },
	{ cmd: 'git commit -m "fix(qa): 修复离散采样越界"', expect: "pass", note: "scope + CJK" },
	{ cmd: 'git commit -m "feat(scan)!: breaking change"', expect: "pass", note: "breaking !" },
	{ cmd: 'git commit -m "chore(deps/dev): bump esbuild"', expect: "pass", note: "scope with /" },
	{ cmd: 'git commit -m "docs: 更新设计文档 (#5)"', expect: "pass", note: "issue ref" },
	{ cmd: 'git commit -m "merge: integrate main into feature branch"', expect: "pass", note: "merge type (issue #1)" },
	{ cmd: 'git commit -m "merge(deps): merge main into scan"', expect: "pass", note: "merge with scope" },
	{ cmd: 'git commit -m "Merge branch \'main\' into feature"', expect: "block", note: "git default merge subject stays blocked (pinned non-goal)" },
	{ cmd: "git commit -m 'refactor(core): split parser'", expect: "pass", note: "single quotes" },
	{ cmd: "git commit -m bareword: ok", expect: "block", note: "bare -m word, bad type" },
	{ cmd: "git commit -m test: bare", expect: "block", note: "bare -m captures only first word 'test:' -> no description" },

	// --- non-conforming messages are blocked ---
	{ cmd: 'git commit -m "update"', expect: "block", note: "no type" },
	{ cmd: 'git commit -m "Feat: add x"', expect: "block", note: "capitalized type" },
	{ cmd: 'git commit -m "feat : add x"', expect: "block", note: "space before colon" },
	{ cmd: 'git commit -m "feat:"', expect: "block", note: "empty description" },
	{ cmd: 'git commit -am "stuff"', expect: "block", note: "-am flag" },
	{ cmd: 'git commit --message="wip"', expect: "block", note: "--message= form" },
	{ cmd: 'git commit --message "wip work"', expect: "block", note: "--message space form" },
	{ cmd: 'git commit -m "feat: ok\nstill bad body"', expect: "pass", note: "only first line is validated" },
	{ cmd: 'git commit -m ""', expect: "block", note: "empty -m string" },
	{ cmd: 'cd repo && git commit -m "bad msg"', expect: "block", note: "commit after &&" },
	{ cmd: 'echo a; git commit -m "update"', expect: "block", note: "commit after ;" },
	{ cmd: 'git pull || git commit -m "update"', expect: "block", note: "commit after ||" },
	{ cmd: 'echo x | git commit -m "update"', expect: "block", note: "commit after |" },
	{ cmd: 'git commit -m"update"', expect: "block", note: "-m with no space (zero-width \\s*)" },
	{ cmd: "git commit --message='wip it'", expect: "block", note: "--message= single-quoted" },
	{ cmd: 'git commit -m "feat(登录): 修复"', expect: "block", note: "CJK scope: \\w is ASCII-only — pinned behavior" },

	// --- not interceptable / not a commit: pass through ---
	{ cmd: "git commit", expect: "pass", note: "no -m, editor commit" },
	{ cmd: "git commit --amend", expect: "pass", note: "amend without -m" },
	{ cmd: "git status", expect: "pass", note: "not a commit" },
	{ cmd: 'echo "git commit -m \\"update\\""', expect: "pass", note: "quoted mention, no false positive" },
	{ cmd: 'git log --grep="git commit -m"', expect: "pass", note: "grep pattern mention" },

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
	// --- issue #2 follow-up: review findings 1-3 ---
	{ cmd: 'git commit -m "" -m "feat: x"', expect: "pass", note: "empty -m is a paragraph separator, later -m is the subject" },
	{ cmd: 'git commit -m "$(cat /tmp/msg.txt)"', expect: "pass", note: "command substitution cannot be judged statically" },
	{ cmd: "git commit -m `cat /tmp/msg.txt`", expect: "pass", note: "backtick substitution fails open" },
	{ cmd: 'git commit 2>&1 -m "update"', expect: "block", note: "redirection before the message still blocks" },
	{ cmd: 'git commit -m "update" 2>&1', expect: "block", note: "trailing redirection still blocks" },
];

let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

for (const { cmd, expect, note } of cases) {
	const got = lintCommitCommand(cmd);
	const tag = note ? `  (${note})` : "";
	if (expect === "pass") {
		check(`${cmd}${tag} -> pass`, got === null, `got hint: ${got?.split("\n")[0]}`);
	} else {
		check(
			`${cmd}${tag} -> block`,
			got !== null && got.includes("Conventional Commits"),
			got === null ? "passed through" : "hint missing guidance",
		);
	}
}

// blocked hint must echo the offending subject so the model can self-correct
const hint = lintCommitCommand('git commit -m "update stuff"');
check(
	"hint echoes subject",
	hint !== null && hint.includes('"update stuff"'),
	hint === null ? "passed through" : undefined,
);

// blocked hint must list merge in the legal types (derived from TYPES)
const mergeHint = lintCommitCommand('git commit -m "Merge branch \'main\' into x"');
check(
	"hint lists merge as legal type",
	mergeHint !== null && mergeHint.includes("revert / merge"),
	mergeHint === null ? "passed through" : "legal-type list missing merge",
);

// multiple -m: first one wins (documented extractCommitMessage behavior)
check(
	"multiple -m keeps first",
	lintCommitCommand('git commit -m "bad" -m "feat: good"') !== null,
);

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

// redirection must not inflate the segment count the hint reports
const redirectHint = lintCommitCommand('git commit -m "update" 2>&1');
check(
	"redirection does not add a phantom segment",
	redirectHint !== null && redirectHint.includes("(1/1)"),
	redirectHint === null ? "passed through" : "position wrong",
);

if (failed) {
	console.error(`\n${failed} checks FAILED`);
	process.exit(1);
}
console.log(`\nall ${cases.length + 8} checks passed`);
