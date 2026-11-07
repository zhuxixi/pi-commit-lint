# Spec: 命令片段级 commit 消息定位（issue #2）

Drafted: deepseek/deepseek-flash (selected) · deepseek/deepseek-flash (physical) @ 2026-11-06T22:45:00+08:00
Revised: deepseek/deepseek-flash (selected) · deepseek/deepseek-flash (physical) @ 2026-11-06T23:05:00+08:00 (round 1)
Revised: deepseek/deepseek-flash (selected) · deepseek/deepseek-flash (physical) @ 2026-11-06T23:25:00+08:00 (round 2)
Revised: deepseek/deepseek-flash (selected) · deepseek/deepseek-flash (physical) @ 2026-11-06T23:40:00+08:00 (round 3)

- 仓库：zhuxixi/pi-commit-lint（main @ abc4d2c，v0.2.0）
- 路由：bug → 根因报告 + 修复设计（调研见 `research/01-repro-matrix.md`、`research/02-kb-prior-art.md`）

## 背景与根因

`lib/commit-lint.ts` 里两个正则各自在**整条命令串**上独立搜索，位置互不关联：

- `COMMIT_RE` 回答「命令串里有没有 `git commit`」；
- `MSG_RE` 回答「整条串里第一个 `-m` 是什么」。

于是「有没有 commit」和「消息在哪」脱钩。调研实测的 8 个坏形态都源于此，其中 **E 否掉了 issue 里建议的最小修复**：

| 形态 | 现象 | 最小修复（MSG_RE 只在 COMMIT_RE 之后搜）是否够 |
|---|---|---|
| A/C2 链式 `unittest -m` 在前 | subject = `unittest` | 够 |
| B/C3 heredoc 正文含 commit | 整条写文件命令被拦 | 不够（要剔除 body） |
| C1/D commit 用 `-F` 文件消息 | 拿别处 `-m` 顶罪 | 不够（要「无 `-m` 即放行」） |
| **E** `git commit -F x && git stash -m "wip"` | subject = `wip` | **不够**（commit 在前） |
| **G** 换行分隔的 commit | 漏拦（false negative） | 不够（分隔符缺 `\n`） |
| **H** `#` 注释里的 commit | 误拦 | 不够（要识别注释） |

结论：正确边界不是「commit 之后的位置」，而是 **commit 所在的命令片段**——先剔除不会执行的文本，再按分隔符切片，只在片段内取消息。

## 目标

issue 中 A / B / C1 / C2 / D 五例全部转为期望行为，并顺带修掉 E（新变体）、G（漏拦）、H（注释误伤）；错误文案补出来源、被判定片段及其位置。

## 非目标（明确拒绝）

- **不做完整 shell 解析**：不处理 `$(...)` / 反引号 / 进程替换内部的嵌套语义、不做变量展开。解析器保持「最小可用切分」，遇不确定结构一律 fail-open（放行）。
- **不读 `-F` / `--file` 指向的文件内容**：读取文件会把纯函数变成有 IO 的函数，且 pi 的 `tool_call` 阶段文件可能尚不存在（同一条命令里先写后提交）。`-F` 一律放行（与 issue 建议一致）。
- **不识别 `git -C dir commit`、`VAR=x git commit` 前缀、`(git commit ...)` 子 shell**：旧实现也不识别，属既有 false negative，本次不扩大范围。
- **不改 `TYPES` / Conventional Commits 规则**，不改 `index.ts` 接线，不做 npm 发版（post-merge 人工动作，见 U1）。

## 设计

### 数据流

```text
raw command string
  └─ maskHeredocBodies()      → 等长字符串：heredoc body / # 注释 → 空格
       └─ splitCommandSegments() → 引号感知，按 && || ; & | \n 切片
            └─ 逐片段：^\s*git\s+commit\b ?
                 └─ extractCommitMessage() → null（-F / 无消息）→ 跳过该片段
                      └─ SUBJECT_RE 校验 → 首个不合规片段 → buildHint(fragment, i, n)
```

首个不合规的 commit 片段决定结果；全部合规或全部无消息 → 放行（返回 null）。

### 三个新增纯函数（导出供单测）

**1. `maskHeredocBodies(command: string): string`**

等长映射（长度不变，位置信息可直接回显）。状态机：normal / `'` / `"` / 转义。

- `<<` 触发 heredoc（`<<<` 是 herestring，跳过）：可选 `-`，可选空白，然后读取分隔符词；分隔符做引号去壳（`'EOF'` / `"EOF"` / `\EOF` → `EOF`）。
- 同一行可出现多个 heredoc，按出现顺序排队。
- 未转义换行后开始消费 body：逐行比对；`<<-` 先剥前导 tab；整行等于分隔符即终止（终止行本身也计入 body）。body 与终止行的非换行字符全部替换为空格。
- 未闭合 heredoc（找不到终止行）：body 延伸到串尾，全部视为不执行。
- `#` 注释：`#` 位于词首（前一字符是空白、`;&|()` 或串首）时，到换行前的字符替换为空格。引号内与 heredoc body 内不处理。

**2. `splitCommandSegments(masked: string): string[]`**

引号感知（`'`、`"`、反斜杠转义）地按 `&&`、`||`、`;`、`&`、`|`、`\n` 切片；过滤 trim 后为空的片段。返回的片段保留内部引号原文（供 hint 回显）。

**3. `extractCommitMessage(segment: string): string | null`**

先做最小 tokenize（空白切词，尊重 `'` / `"` / 反斜杠转义并去壳），然后按序匹配，**第一个命中即返回**：

| token 形态 | 消息取值 |
|---|---|
| `--message=<v>` | `<v>` |
| `--message` | 下一个 token（无则 null） |
| `-<letters>m`（`-m`、`-am`、`-qm` 等短选项簇） | 下一个 token（无则 null） |
| `-m<v>`（`-mfoo`） | `foo` |
| 其他（含 `-F`、`--file`） | 不命中 → 继续找，最终 null |

`lintCommitCommand(command: string): string | null` 只做组合，不含正则搜索逻辑。

### 行为决策表

| 命令形态 | 旧行为 | 新行为 |
|---|---|---|
| `… && git commit -m "fix: x"` | BLOCK（前面 `-m`） | pass |
| heredoc 正文含 `&& git commit -m …` | BLOCK | pass |
| `git commit -F x && git stash -m "wip"` | BLOCK | pass |
| `#` 注释里的 commit | BLOCK | pass |
| 引号内含 `&&` | pass | pass（不变） |
| 换行分隔的 `git commit -m "update"` | pass（漏拦） | BLOCK |
| 裸 `git commit -m "update"` | BLOCK | BLOCK（不变） |
| `git commit -m "feat: ok\nstill bad body"`（引号内真换行） | pass | pass（引号内不切） |
| 同一次提交的多个 `-m`（`-m "feat: x" -m "body"`） | pass | pass（**取首个，契约不变**） |
| 两次独立提交 `git commit -m "feat: x" && git commit -m "bad"` | pass（只看第一个 `-m`） | BLOCK（第二个 commit 片段不合规） |

### 错误文案

```text
🚫 commit message 不符合 Conventional Commits，已阻止提交。

来源: pi 扩展 @zhuxixi/pi-commit-lint（不是仓库的 git hook）
检测到的命令片段 (2/5): `git commit -m "update stuff"`
当前 subject: "update stuff"
要求格式: type(scope)?: 描述
合法 type: feat / fix / … / revert / merge

示例:
  feat(scan): 新增整页 OCR
  fix(qa): 修复离散采样越界
  docs: 更新设计文档 (#5)

请改成规范格式后重新提交。
```

- 片段超过 160 字符时保留头部 + `…（已截断）`。
- 位置编号基于「trim 后非空的片段」序号 / 总数，用于定位链式命令里是哪一段被判。
- 保留既有断言锚点：`Conventional Commits`、`JSON.stringify(subject)`、`revert / merge`。

### 风险与缓解

| 风险 | 缓解 |
|---|---|
| 新增「换行 = 分隔符」会扩大拦截面 | 先掩掉 heredoc body 与注释；A1 保留 G 之外的旧用例全量不回归 |
| 状态机误判（未闭合引号/heredoc 吞掉后半段） | 一律 fail-open（放行），不会造成误拦；A2 覆盖未闭合 heredoc |
| 短选项簇识别过宽（`-Fmsg` 之类） | 仅当 token 以 `m` 结尾且形如 `-<letters>m` 才取下一 token；A4 含 `-Fmsg` → null 反向用例 |
| `2>&1` 在 `&` 处被切成两段 | 无害：commit 片段仍保留消息；A3 含 `git commit -m "update" 2>&1` 显式用例 |

## 验收矩阵

| ID | 功能点 | 验收方式 | 具体验证 | 通过标准 |
|----|--------|----------|----------|----------|
| A1 | 真机复现 9 例 + 多片段 1 例的端到端判定 | 自动化验证（unit） | `bash test/run-all.sh`；在 `test/commit-lint.test.ts` cases 表新增：A `python3 -m unittest test_x -v && git commit -m "fix: real subject"` → pass；B heredoc 正文含 commit → pass；C1 `git commit -q -F /tmp/msg.txt && … && python3 -m unittest` → pass；C2 长链 unittest 在前 → pass；D `git stash push … -m "…" && git add -A && git commit -F …` → pass；D2 stash `-m` + 合规 `-m` → pass；E `git commit -F … && git stash push -m "wip"` → pass；G 换行分隔 `git commit -m "update"` → block；H `ls -la # see && git commit -m "update"` → pass；**I 多片段 `git commit -m "feat: ok" && git commit -m "bad"` → block** | 全部匹配，脚本 exit 0，存量 **32 条 cases（35 项断言）** 不回归 |
| A2 | heredoc 掩码 | 自动化验证（unit） | 新增 `test/shell-parsing.test.ts`：① `<<'EOF'` 引号分隔符；② `<<-EOF` 前导 tab；③ 单行两个 heredoc；④ 未闭合 heredoc；⑤ `<<<` herestring 不吞后续；⑥ `#` 注释被掩、`a#b` 不被掩；⑦ 引号内的 `<<` 不触发 | 掩码后字符串与期望一致（等长、body 区全空格） |
| A3 | 片段切片 | 自动化验证（unit） | 同文件：`&&`、`\|\|`、`;`、`\|`、`&`、`\n` 各切一次；引号内 `&&` 不切；`git commit -m "a && b"` 单片段；**`git commit -m "update" 2>&1` 显式用例（`&` 处切分，commit 片段仍含完整消息）** | 片段数组逐项相等 |
| A4 | 消息提取 | 自动化验证（unit） | 同文件：`-m "x"`、`-am "x"`、`-qm "x"`、`--message "x"`、`--message="x"`、`-mfoo`、转义引号 `"a \"b\" c"`、多 `-m` 取首个、仅 `-F file` → null、**`-Fmsg` → null（短选项簇白名单反向用例）**、`git commit --amend` → null | 返回值逐项相等 |
| A5 | hint 内容 | 自动化验证（unit） | `test/commit-lint.test.ts` 尾部断言：来源行含 `pi 扩展` 与包名；含 `检测到的命令片段 (n/m)`；含原始片段文本；`hint echoes subject` 旧断言保留；**新增 >160 字符片段的截断用例**（断言出现 `已截断` 标记且 `(n/m)` 编号仍正确）；**多片段用例断言编号为 `(2/2)`**（与 A1 的 I 例共用输入） | 断言全通过 |
| A6 | 文档机械一致项 | 自动化验证（static） | ① `grep -n 'Unreleased' -A6 CHANGELOG.md` 含 `#2`；② **定点 fixed-string 反查旧口径**：`grep -F 'The first `-m`/`-am`/`--message` value is extracted' README.md` 无命中（该句描述旧 MSG_RE 行为，新设计下必被改写）；③ **正向断言**：`grep -F '## Limitations' README.md` 命中（本 spec 要求新增的能力边界小节真实存在） | 三条 grep 结果符合预期；反向锚点必须是**将被删除的整句**，不用 `heredoc bodies` 这类改写后仍会合法出现的词 |
| A7 | 文档语义一致性 | 人工核对 + CR 复查 | 逐段比对 README 的 heredoc / `#` 注释 / `-F` / `git -C` 表述与 `lib/commit-lint.ts` 实现 | 无口径漂移，Limitations 段列出的未支持项与代码一致 |
| U1 | 发布后真机行为 | 用户实测 | ① 合并后先做发版提交 `chore: release v0.3.0`（本仓惯例：版本 bump 独立成一个 release commit，参照 `chore: release v0.2.0`）——把 `package.json` version 0.2.0 → 0.3.0、`CHANGELOG.md` 的 `[Unreleased]` 改名立版本再发 npm；② 本机更新 `pi update --extensions`（README 为已装用户钉住的更新路径；若未生效再 `pi remove` + `pi install npm:@zhuxixi/pi-commit-lint`），并**确认安装产物版本为 0.3.0 后再继续**，`/reload`；③ 新 session 跑 `python3 -m unittest test_x -v && git commit -m "fix: real subject"` → 应放行；④ heredoc 写含 commit 示例的文件 → 应放行；⑤ `git commit -m "update"` → 应拦截且文案含来源行与片段回显 | 版本确认为 0.3.0；③④ 放行、⑤ 拦截且文案正确 |
| U2 | KB 笔记修正 | 用户实测 | 合并后更新 JFox 笔记「本机多行 git commit -m 会被拦截器误判」的「来源未定位」段 | 笔记补充指出本扩展 |

## 可测性拆分设计

- 检测层拆成 3 个纯函数（`maskHeredocBodies` / `splitCommandSegments` / `extractCommitMessage`），零 IO、零全局状态、字符串进字符串出 → 直接用表驱动单测（`test/shell-parsing.test.ts`，走同一 `run-all.sh` harness）。
- `lintCommitCommand` 退化为组合层（遍历片段 + 调 `SUBJECT_RE` + 拼 hint），由既有 `test/commit-lint.test.ts` 表驱动覆盖端到端判定。
- `index.ts` 事件接线不变，不在测试范围（`tool_call` 到 `{ block, reason }` 的映射是 3 行转发，无分支）。
- 测试边界：不 mock、不写文件、不启动 pi、不依赖 locale；所有用例是字符串字面量。
- hint 文案断言用 `includes` 而非全文相等，避免措辞微调时大面积改测试。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `lib/commit-lint.ts` | 重写检测层：新增 3 个导出纯函数，`lintCommitCommand` 改为组合；hint 增加来源行 / 片段回显 / 位置 |
| `test/commit-lint.test.ts` | 新增 10 条端到端用例 + hint 断言（含超长片段截断与 `(n/m)` 编号）；存量用例不动 |
| `test/shell-parsing.test.ts` | 新增：A2 / A3 / A4 的 helper 单测 |
| `package.json` | **不在本 PR 改**：version 0.2.0 → 0.3.0 由 post-merge 的发版提交 `chore: release v0.3.0` 负责（见 U1①），与 `chore: release v0.2.0` 惯例一致 |
| `README.md` | Features 的 false-positive 段改写；How It Works 更新为四步；Troubleshooting 增「被拦先看来源行」；新增 Limitations 段（`-F`、`git -C`、`$()` 不做） |
| `CHANGELOG.md` | `[Unreleased]` → `### Fixed`：命令片段级消息定位 + 来源/片段回显（closes #2） |
