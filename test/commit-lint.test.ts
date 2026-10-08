/**
 * Positive/negative cases for lintCommitCommand() — issue #6.
 * Covers Conventional Commits conformance (SUBJECT_RE), -m extraction
 * (MSG_RE), and git-commit detection without false positives (COMMIT_RE).
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

// multiple -m: first one wins (documented MSG_RE behavior)
check(
	"multiple -m keeps first",
	lintCommitCommand('git commit -m "bad" -m "feat: good"') !== null,
);

if (failed) {
	console.error(`\n${failed} checks FAILED`);
	process.exit(1);
}
console.log(`\nall ${cases.length + 3} checks passed`);
