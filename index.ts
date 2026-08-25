/**
 * Commit Lint Extension for pi
 *
 * Port of the Claude Code PreToolUse hook (~/.claude/scripts/commit_lint.py).
 * Intercepts `git commit -m ...` in the bash tool and validates the message
 * against Conventional Commits. Non-conforming messages are blocked with a
 * corrective hint (sent back to the model as the tool error); commits without
 * -m (editor/heredoc) pass through.
 *
 * Validation logic lives in lib/commit-lint.ts (pure, unit-tested); this file
 * only wires it into pi's event loop.
 *
 * Installed via `pi install npm:@zhuxixi/pi-commit-lint`, hot-reload with
 * /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lintCommitCommand } from "./lib/commit-lint";

// Re-export the pure validator so existing imports from this entry keep working.
export { lintCommitCommand };

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: string };
		const reason = lintCommitCommand(input.command ?? "");
		if (reason) return { block: true, reason };
	});
}
