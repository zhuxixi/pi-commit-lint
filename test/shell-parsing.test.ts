/**
 * Unit tests for the shell-scanning helpers behind lintCommitCommand()
 * (issue #2). Each helper is pure: string in, string or string[] out.
 *
 * Run with (no test framework — zero-dep, bundled by esbuild):
 *   npx esbuild test/shell-parsing.test.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/shell-parsing-test.mjs && node /tmp/shell-parsing-test.mjs
 */
import { extractCommitMessage, maskHeredocBodies, splitCommandSegments } from "../lib/commit-lint";

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

if (failed) {
	console.error(`\n${failed} checks FAILED`);
	process.exit(1);
}
console.log("\nall shell-parsing checks passed");
