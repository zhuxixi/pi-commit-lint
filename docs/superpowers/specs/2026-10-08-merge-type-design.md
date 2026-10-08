# Spec: allow `merge` as a commit type (issue #1)

- 仓库：zhuxixi/pi-commit-lint（main @ 4b6bff7）
- 决策：方案 A（仅给 `TYPES` 加 `merge`，不做 `^Merge ` 前缀放行）；CC 侧
  hook（~/.claude/scripts/commit_lint.py）不改——用户已确认 Claude Code 完全
  弃用，工作流整体在 pi 上。

## 背景

`merge:` subject（手写 merge 提交，如 `merge: integrate main into feature
branch`）被 `lintCommitCommand` 拦截，因为 `TYPES` 不含 `merge`。真实痛点来自
jfox PR #488：分支内 merge main 时被迫用 `chore:` 前缀，丢失语义。JFox KB
permanent note「commit message 全局 block hook」（2026-09-04 修正段）已给出
解法即「给扩展加 merge 合法类型」。

## 设计

改动共 3 个文件，全部为常量/文档同步，无逻辑分支变化：

1. **lib/commit-lint.ts:7** — `TYPES` 追加 `|merge`：
   `const TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge";`
   `SUBJECT_RE` 由 TYPES 插值生成，deny 提示里的合法 type 列表由
   `TYPES.split("|")` 派生——两处自动跟进，无需单独改。
2. **test/commit-lint.test.ts** — 用例表新增 3 行（见验收矩阵 A1）。
3. **README.md** — 两处合法 type 列表同步加 merge：
   - L17 展示文案：`合法 type: feat / fix / ... / revert / merge`
   - L95 规则描述里的 TYPES 字符串
4. **CHANGELOG.md** — `[Unreleased]` 下加 `### Added` 条目：`merge` 加入
   合法 commit type 集合。

deny 提示的示例列表（feat/fix/docs 三行）**不改**——示例只示意格式，无需穷举
type；merge 已出现在「合法 type」行，模型能自行套用格式。

## 非目标（明确拒绝）

- **`^Merge ` 前缀放行**（issue 中的 optional 部分）：干净 merge 由 `git
  merge` 自动提交，不经过 `git commit -m`，linter 本就拦不到；`Merge ...`
  经 -m 显式提交属低频场景（--no-commit/amend 流），且 hint 已引导一次重试
  改写。引入免检前缀会降低 linter 严格度，收益不抵。行为钉死：
  `Merge branch 'main' into feature` 仍 block，有用例固定。
- **CC hook 同步**：CC 已弃用，不改。
- **npm 发版与本机更新**：post-merge 人工动作（发 0.2.0 + `pi install` 更新
  本机 + /reload），不在本 PR 自动化范围，见 U1。

## 验收矩阵

| ID | 功能点 | 验收方式 | 具体验证 | 通过标准 |
|----|--------|----------|----------|----------|
| A1 | `merge` type 被接受、`Merge` 前缀不放行、提示列表含 merge | 自动化验证（unit） | `bash test/run-all.sh`，新增用例：① `git commit -m "merge: integrate main into feature branch"` → pass；② `git commit -m "merge(deps): merge main into scan"` → pass（带 scope）；③ `git commit -m "Merge branch 'main' into feature"` → block（钉死非目标）；④ block hint 文本包含 `merge`（合法 type 列表派生验证） | 全部用例通过，脚本 exit 0；存量 31+2 用例不回归 |
| A2 | README/CHANGELOG 与实现一致 | 自动化验证（static） | `grep -n 'revert' README.md CHANGELOG.md` 人工核对 + CR 复查 | README 两处 type 列表、CHANGELOG Unreleased 条目均含 merge，无遗漏的旧列表 |
| U1 | 发布后本机真实拦截行为 | 用户实测 | ① 合并 PR 后 npm 发版（0.2.0）；② 本机 `pi install npm:@zhuxixi/pi-commit-lint` 更新 + `/reload`；③ 新 session 里让 agent 跑 `git commit -m "merge: test subject"`（在临时 git 仓）→ 应真实执行不被拦；④ 再跑 `git commit -m "update"` → 应被拦并返回含 merge 的合法 type 提示 | ③ 放行、④ 拦截且提示正确；注意 npm 发版后 root metadata 有几分钟 404 延迟，轮询到 200 再装 |

## 可测性拆分设计

现有边界已满足要求，不新增函数：`lintCommitCommand(command: string):
string | null` 是零依赖纯函数，type 集合是其模块内常量。测试边界 = 纯函数
字符串输入/输出（hint 文本 vs null），不涉及 pi 事件循环（index.ts 接线层
不在测试范围，本次也不改它）。新增用例直接进现有表驱动 harness
（cases 数组 + check 循环），hint 内容断言复用文末既有「hint echoes
subject」同款模式。

## 风险

低。改动为常量追加，正则语义仅放宽（新增一个可接受 type），存量放行/拦截
行为不变；唯一新行为就是 `merge:` 前缀 subject 从 block 变 pass，这正是需求。
