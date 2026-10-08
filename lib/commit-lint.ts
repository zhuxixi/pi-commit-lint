/**
 * Conventional Commits validation for `git commit -m ...` commands.
 * Pure functions, zero pi dependency — unit-testable via esbuild+node.
 * The extension entry (index.ts) only wires this into pi's event loop.
 */

const TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge";
const SUBJECT_RE = new RegExp(`^(${TYPES})(\\([\\w./-]+\\))?!?: .+`);
// -m "..." / -am "..." / --message="..." / --message "..." / -m '...' / bare -m word
// (first match = subject; multiple -m keep the first)
const MSG_RE = /(?:\s-m\b|\s-am\b|--message[=\s])\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/;
// git commit must start the command or follow a command separator (&& || ; & |),
// so quoted text / heredoc bodies / grep patterns mentioning "git commit" don't
// false-positive (CC original matched anywhere — hit twice in one session).
const COMMIT_RE = /(?:^|&&|\|\||[;&|])\s*git\s+commit\b/;

function buildHint(subject: string): string {
	return [
		"🚫 commit message 不符合 Conventional Commits，已阻止提交。",
		"",
		`当前 subject: ${JSON.stringify(subject)}`,
		"要求格式: type(scope)?: 描述",
		`合法 type: ${TYPES.split("|").join(" / ")}`,
		"",
		"示例:",
		"  feat(scan): 新增整页 OCR",
		"  fix(qa): 修复离散采样越界",
		"  docs: 更新设计文档 (#5)",
		"",
		"请改成规范格式后重新提交。",
	].join("\n");
}

/**
 * Returns a block reason if `command` is a non-conforming `git commit -m`,
 * else null (pass through). Pure function — exported for unit testing.
 */
export function lintCommitCommand(command: string): string | null {
	if (!COMMIT_RE.test(command)) return null;
	const m = MSG_RE.exec(command);
	if (!m) return null; // no -m (editor/heredoc commit), can't intercept — pass
	const subject = (m[1] ?? m[2] ?? m[3] ?? "").trim().split("\n", 1)[0].trim();
	if (SUBJECT_RE.test(subject)) return null;
	return buildHint(subject);
}
