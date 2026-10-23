# 计划：复习功能
> 状态：第一期（最小版，第 1–9 节）已实现并验证。第二期（降噪规则，第 10–16 节）的设计决定已全部确定，尚未实现。
> 
> 术语：本文统一使用「节点」指图谱中的命题，与界面用词一致；代码标识符（如 `proposition`、`graphContext.propositions`）保持原样。

调查依据：`src/agent/tools/practice.ts`、`src/core/native-messages.ts`（`problemInputForConclude`）、`src/core/question-core.ts`、`app/api/chats/route.ts`、`components/new-session.tsx`、`src/store/graph.ts`、`src/core/ports.ts`、`docs/architecture.md` §7、`docs/vision.md`。

* * *
# 第一期：最小版
范围：复习记录、到期列表、用到期节点开练习会话。不含 FIRe、五态状态机、70/30 混排、速度门禁和 CAT 诊断（见第 7 节）。
## 1. 目标
学习者每次做完带 `target` 的练习题，系统记录该节点在何时、以什么表现被检索。之后提供「到期复习」列表，选中到期节点即可开一个练习会话。
## 2. 现状：复习信号的来源
| 来源 | 能否给出节点级信号 | 说明 |
|---|---|---|
| 练习会话的 `problem` 与 `conclude` | 能 | `problem.target` 是图谱节点 ID（写入时校验，名称会规范成 ID）；`conclude` 带 `outcome`、`rung`（R0–R5 或 null）、`missClass`、`retest` |
| 教学会话里的 quiz | 不能 | quiz 的 `nodeId` 是会话内计划树的节点，不是图谱节点 ID |
| 自由话题的练习（没有 `target`） | 不能 | 题目未标注节点 |

因此复习信号只来自带 `target` 的练习题。只在练习里出现过的节点才会进入复习。

本机 `data/` 中没有练习会话（143 个 chat 里 practice 为 0，图谱节点为 0），无法用真实数据估计信号量；以上结论来自代码。
## 3. 设计约束
1. `docs/architecture.md` §7 写明 `spaced repetition…stays parked`，并规定 grading 不向图谱写入任何内容。这是上游作者的裁决。本 fork 有意推翻其中关于复习的部分，但保留其原则：复习状态不写进节点，图谱仍是纯世界模型。
  
2. `docs/vision.md` 规定 understanding 只推断、不编码，派生状态不存储，事件账本是事实来源。因此复习状态从事件派生，不存储一个会过期的数字。
  
3. 分层规则：`src/core` 是纯函数，不能导入 `agent`、`server`、`store`。调度算法放在 core。
  
## 4. 设计
### 4.1 数据来源（Q1，已定：方案 A）
- **方案 A（采用）：从聊天记录派生，不新增存储。** 扫描所有 `kind === "practice"` 的 chat，对每个干净的 `conclude`，用 `problemInputForConclude` 取出配对的 `problem.target`，得到事件 `{nodeId, at, outcome, rung, missClass}`。
  
  - 优点：无新存储，无格式变更；自动覆盖已有的全部练习历史；符合「派生不存储」；不存在账本与 chat 不一致的问题。
    
  - 缺点：每次读取都要扫描 chat（143 个文件量级没有问题，数千个时再加缓存）；删除一个 chat 会同时删除其复习记录。
    
- **方案 B（未采用）：新增追加式账本** `data/graph/reviews.jsonl`**，**`conclude` **时写入一行。**
  
  - 优点：删除 chat 不丢历史；读取快。
    
  - 缺点：需要新增 `LEDGER_FILES`、store、port 和格式版本戳；已有练习不会自动补录；写入点要接入 turn 流程。
    
### 4.2 outcome 到评级（Q2 已定）
FSRS 的评级为 Again、Hard、Good、Easy。映射只看 `outcome` 和 `rung`：

| conclude | FSRS 评级 |
| --- | --- |
| `solved` 且 rung 为 null、R0 或 R1 | Good（不使用 Easy） |
| `solved` 且 rung ≥ R2，或 `solvedWithHints` | Hard |
| `surrendered` | Again |
| `movedOn` | 不产生事件 |
| `dismissed` | 不产生事件（系统合成，没有检索证据） |
### 4.3 调度（已定：`ts-fsrs`，FSRS-6，默认权重）
- 依赖 `ts-fsrs`。它是纯函数库，放在 `src/core` 不违反分层 lint（lint 只禁止 core 导入 agent、server、store）。
  
- 每个节点的状态由重放得到：对按时间排序的事件，从空卡片开始逐个调用 FSRS，折叠成 `{ due, stability, difficulty, state, lapses, lastReview }`。纯函数，`now` 作为参数传入。
  
- 目标保持率 `request_retention` 为 0.9，定义在 core 的一处常量中。
  
- 关闭 Anki 式的分钟级学习步骤（`learning_steps`、`relearning_steps` 为空），否则首次答对后 10 分钟就会到期。关闭 fuzz，保证结果确定。
  
- 同一天的多次复习由 FSRS-6 的短期权重处理，不再手写去重。
  
- 已从图谱中删除的节点直接丢弃，不报错。
  
- 排序：到期时间越早（逾期越久）越靠前；不引入权重，不引入掌握度分数。
  
- 默认权重由 Anki 闪卡数据训练；本项目的事件是 LLM 判分的开放式推理题，噪声更大，也没有足够数据训练个人权重。间隔天数只作参考。
  
- 测试覆盖：事件乱序、同日重复、已删节点、无 `target`、`dismissed` 与 `movedOn` 被忽略。
  
### 4.4 界面与启动复习
- 后端：`GET /api/review` 返回 `{ due: [...], upcoming: [...], now, sessionSize }`，由 core 的派生函数加 server 的 chat 读取组成。只读，不触发写入。
  
- 入口（Q5 已定）：侧边栏新增 Review 行，显示到期数量；打开后是到期列表，默认勾选逾期最久的前 8 个，点击 Start review 启动。
  
- 启动：复用 `startDraftSession(draft, fetch, "practice", picks)`，把所选节点作为 `graphContext.propositions`。会话标题和第一条消息为 `Review: 节点名列表`。不新增题型，也不改练习提示词；`conclude` 自然成为下一次复习事件。
  
- 节点数上限（Q6 已定）：`app/api/chats/route.ts` 对 picks 做 `.slice(0, 64)`；界面默认 8 个，可手动调整，最多 64 个。
  
## 5. 文件改动清单
| 位置 | 改动 |
|---|---|
| `package.json` | 新增依赖 `ts-fsrs` |
| `src/core/review-events.ts`（新） | 从 `LhMessage[]` 提取事件，复用 `problemInputForConclude` |
| `src/core/review.ts`（新） | 评级映射、用 ts-fsrs 重放、到期筛选与排序、payload 派生 |
| `src/core/review-payload.ts`（新） | 浏览器可用的 payload 类型与常量 |
| `src/core/index.ts` | 导出 payload 与事件类型 |
| `src/server/review.ts`（新）、`app/api/review/route.ts`（新） | 读取所有 practice chat，调用 core，提供 `GET` |
| `components/review-*.tsx`、`components/sidebar.tsx`、`app/review/page.tsx` | 列表页与侧边栏入口 |
| `docs/architecture.md` §7 | 说明复习状态派生自练习事件，不写入图谱 |
| `tests/review*.test.ts*`、`tests/render-review.test.tsx` | 表驱动测试 |
## 6. 验证方式
- core 全部是确定性单测，不联网，不用真实时钟。
  
- 运行 `npx tsc --noEmit`、`npm test`、`npm run lint`（lint 强制分层）。
  
- 在真实应用中走一遍：造练习会话、查看到期列表、启动复习会话、作答并确认评级写回。
  
## 7. 不在本期范围内
- FIRe 隐式复习（沿 chain 给前置节点补充弱证据，合并选题）。
  
- 五态状态机、70/30 混排、速度门禁（只对代码题有意义，待代码题能力完成后再评估）。
  
- CAT 诊断：本图谱只含已学内容，没有「尚未学习的上游」，价值有限。
  
- 教学会话 quiz 进入复习：需要先把 quiz 与图谱节点对齐，是独立问题。
  
- 闪卡：`docs/code-practice-plan.md` 已写明是独立计划。
  
## 8. 第一期决定汇总
| 问题  | 决定  |
| --- | --- |
| 范围  | 复习记录、到期列表、用到期节点开练习会话 |
| Q1 数据来源 | 方案 A：从聊天记录派生，不新增存储 |
| 调度算法 | `ts-fsrs`（FSRS-6，默认权重，目标保持率 0.9）；手写系数与同日去重不再需要 |
| Q2 `movedOn` | 不产生事件 |
| Q-Easy | 不使用 Easy：`solved` 且无提示或只用 R0–R1 都算 Good |
| Q5 入口 | 侧边栏独立 Review 页 |
| Q6 节点上限 | 默认 8 个，页面中可手动调整 |
| Q7 架构文档 | 在 `docs/architecture.md` §7 加说明，明确推翻 `parked` |
| 会话文字 | 标题与第一条消息为 `Review: 节点名列表` |
## 9. 第一期实施顺序（已完成）
1. `src/core/review-events.ts` 与测试。
  
2. `src/core/review.ts` 与测试，添加 `ts-fsrs` 依赖。
  
3. `src/server/review.ts`、`GET /api/review` 与测试。
  
4. Review 页、侧边栏入口、渲染测试，接入 `startDraftSession`。
  
5. `docs/architecture.md` §7 说明；运行 `tsc`、`lint`、`test`，并在真实应用中验证。
  

* * *
# 第二期：降噪规则
本期只改变「证据如何变成评级」，不改变 FSRS 本身。
## 10. 背景：噪声来源与同类产品的做法
事件是 LLM 判分的开放式推理题，默认权重又由闪卡数据训练。参考两个同类产品：

| 产品  | 处理噪声的做法 | 是否采用 |
| --- | --- | --- |
| Execute Program（Python 课程） | 从源头避免判分噪声：复习项是小代码例子，通过运行代码判分；答错时把等级减半，而不是清零 | 不采用。它依赖代码题的确定性判分，属于另一项工作 |
| Nodeledge | 不针对单次不良结果采取行动，先验证再干预；复习高阶节点时同时强化其前置节点 | 采用「先验证再干预」的思路（R2）；前置节点强化属于第 7 节的 FIRe |

来源说明：Execute Program 的「等级减半」来自搜索结果对其 Spaced Repetition 页的摘要，未能读到原页；Nodeledge 的做法来自其 how-it-works 页的高层描述，页面未公开公式或参数。
## 11. 现有规则的两个问题
使用 `ts-fsrs` 默认参数实测。设节点已稳固：第 0、2、13 天各答对一次（Good），稳定度 S 为 46 天。

| 情形  | 结果 S | 下次到期 |
| --- | --- | --- |
| 第 30 天一次 Again | 2.69 | 3 天后 |
| 第 30 天 Again，同日重测 Good | 2.69 | 4 天后 |
| 第 30 天 Again，第 32 天 Good | 6.25 | 6 天后 |

1. **单次失败使稳定度骤降。** 稳定度 46 天的节点，一次 Again 降到 2.7 天。若这次失败源于粗心、执行失误或 LLM 判分偏严，损失过大。
  
2. **同场重测对调度几乎没有作用。** 练习提示词要求失败后重测，但重测发生在揭晓答案之后，FSRS-6 的同日公式基本不为它增加稳定度。
  
## 12. 规则 R1：只把记忆性失败当作失败（Q8 已定）
`conclude` 已记录 `missClass`，现有评级未使用它。

| missClass | 含义  | 评级处理 |
| --- | --- | --- |
| `cue` | 完全想不起来 | 记忆失败，按 4.2 的规则 |
| `discrimination` | 选错了候选命题 | 记忆失败，按 4.2 的规则 |
| `structural` | 提取出的命题本身有误（误解） | 记忆失败，按 4.2 的规则 |
| `execution` | 命题正确，执行时出错 | 不是遗忘，评级为 Good |
| `careless` | 粗心  | 不是遗忘，评级为 Good |
| null | 没有失误 | 按 4.2 的规则 |

补充：

- 仅对 `solved` 与 `solvedWithHints` 生效，并且不再因 rung ≥ R2 降为 Hard，因为需要提示的原因是执行问题，不是想不起来。
  
- `surrendered` 始终是 Again。
  

决定：`execution` 与 `careless` 都评为 Good。
## 13. 规则 R2：已稳固节点的首次失败只作暂定处理（Q9、Q10、Q11 已定）
对应 Nodeledge 的「先验证再干预」。

**适用范围（Q10 已定）：** 仅适用于已稳固的节点，即当前稳定度 ≥ 7 天。新节点的 Again 照常处理，因为可损失的稳定度很少。

不用「已成功复习至少 2 次」作标准，因为 FSRS 的 `reps` 把同一天的多次复习也计入。实测同一天连续答对 3 次，`reps` 为 3，而稳定度仍是 2.31；隔 2 天再答对一次，稳定度才升到 10.96。稳定度 ≥ 7 天要求真正隔开一段时间后仍然答对。

**流程**（每个节点按时间重放）：

1. 已稳固的节点出现 Again：不更新 FSRS 状态，标记为「暂定失败」，到期时间设为 1 天后。
  
2. （Q11 已定）同一场会话中，暂定失败之后的事件一律忽略。这些事件发生在揭晓答案之后，不能证明长期记忆。
  
3. 之后的会话中再次复习：
  
  - 再次失败：确认失败，按 Again 更新。
    
  - 成功（Q9 已定）：评级最高为 Hard。
    

**实测对比**（S = 46 天，第 30 天首次失败）：

| 之后的结果 | 现有规则 | R2  |
| --- | --- | --- |
| 第 32 天 Good | S = 6.25，6 天后到期 | 按 Hard：S ≈ 81，81 天后到期 |
| 第 32 天 Again | S = 0.61，1 天后到期 | S = 2.71，3 天后到期 |

若暂定失败之后的成功仍按 Good 评级，稳定度为 104.62，约 105 天后到期；封顶 Hard 后为 81 天。

**取舍：** R2 对偶然失败的惩罚明显更轻（81 天对 6 天），避免一次噪声使稳定度被大幅下调。代价是：若这次失败反映真实遗忘，而下一次又偶然答对，系统会高估掌握程度。已决定接受，理由是 1 天后会再验证一次，且成功后评级上限为 Hard，不是 Good。
## 14. 状态机
每个节点的重放状态增加一个暂定失败标记 `pending`（记录失败时间与所属会话）：

```
对每个事件 e（按时间排序），grade = 评级映射（含 R1）：

若 pending 存在：
    若 e 与 pending 属于同一会话：忽略 e
    否则：
        若 grade 为 Again：按 Again 更新，清除 pending
        否则：按 min(grade, Hard) 更新，清除 pending
否则：
    若 grade 为 Again 且节点稳定度 ≥ 7 天：
        设置 pending = (e 的时间, e 的会话)，FSRS 状态不变
    否则：
        按 grade 更新

输出的 dueAt：
    pending 存在 → pending 的时间 + 1 天
    否则 → FSRS 的 due
```
## 15. 文件改动清单
| 位置 | 改动 |
|---|---|
| `src/core/review-events.ts` | `ReviewEvent` 增加 `missClass` 与 `session`（chat ID）；`reviewEventsFromMessages(messages, session)` |
| `src/server`、`src/core/review.ts` 中的 `reviewPayload` | 向事件提取传入各 chat 的 ID |
| `src/core/review.ts` | `gradeOf` 实现 R1；`foldReviews` 的重放改为带 `pending` 的状态机（第 14 节）；`NodeReview` 增加 `verifying: boolean` |
| `src/core/review-payload.ts`、`components/review-view.tsx` | `ReviewItem` 增加 `verifying`；到期行在 `verifying` 时标注「待再次确认」 |
| `tests/review*.test.ts*` | R1 覆盖每种 `missClass`；R2 覆盖首次失败、同会话后续事件被忽略、之后成功封顶 Hard、之后失败被确认、新节点（稳定度 < 7 天）不受影响、稳定度恰为 7 天的边界、同日重复复习不使节点变为「已稳固」 |
| `docs/architecture.md` §7 | 补充评级规则 R1、R2 |
## 16. 第二期决定汇总
| 问题  | 决定  |
| --- | --- |
| Q8 `execution` 与 `careless` | 都评为 Good，且不因 rung ≥ R2 降为 Hard |
| Q9 暂定失败之后的成功 | 评级最高为 Hard |
| Q10 「已稳固」的标准 | 稳定度 ≥ 7 天（不使用 reps ≥ 2） |
| Q11 同会话中暂定失败之后的事件 | 一律忽略 |
