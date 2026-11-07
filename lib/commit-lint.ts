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
		if (value.startsWith("--message=")) return value.slice("--message=".length);
		// Attached form must win over the cluster form: `-mfrom` is message
		// "from", not a flag cluster that happens to end in "m".
		if (value.startsWith("-m") && value.length > 2) return value.slice(2);
		// Only value-less short flags may precede the trailing `m`; flags that
		// take a value (`-F`, `-C`, `-c`, `-S`, `-t`) must not match here.
		if (/^-[aeinopqsuvN]+m$/.test(value)) return next();
	}

	return null;
}
