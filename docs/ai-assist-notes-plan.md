# 会议中 AI 辅助笔记功能 · 实施计划

> 依据 PRD《会议中 AI 辅助笔记功能》制定。目标：把左侧「我的笔记」从空白编辑器升级为「会听会议、理解上下文」的笔记编辑器，AI 始终作为**建议层**存在，不抢用户编辑权。分阶段落地，每阶段可独立验证。

---

## 0. 现状映射（复用 vs 新增）

| PRD 主题 | 现状 | 结论 |
| --- | --- | --- |
| 笔记编辑器 | `frontend/ui-components.js#createNotesEditor`，live 视图 `#data-live-notes-root`，详情页「我的笔记」tab | 复用，在其上叠加 AI 建议层 |
| 实时字幕 | `backend/worker_session.py` 发 `transcript.partial/final/refined`；前端 `app.js#renderLiveEvent` | 复用，作为 AI 的输入与轻量检测触发器 |
| AI 纪要（会后） | `worker_llm.py#summarize` + `summaryModelCopy` 配置 + `summary-models.json` + `secrets/*.key` | **复用同一套 LLM provider/key 配置**，实时辅助不再另设一套密钥 |
| 内置 AI（本地推理） | `worker_llama_sidecar.py`：命名 sidecar 子进程跑 GGUF | 复用，但需为其增加「短超时 + 可取消」变体 |
| 在线 AI | `llm_client.py#complete`（OpenAI/Claude 兼容，超时） | 复用，实时任务传短超时 |
| 工作区 | `store_workspaces.py` + `meetings.workspace_id` | 复用，作为第二层上下文分析的检索边界 |
| Onboarding | `app.js#openOnboardingLanguage/Permissions/Setup` 顺序 | 在其后追加 AI 配置页 |
| 配置存储 | `main.js` 读/写 `summary-models.json`、`setSecret/getSecret` | 新增 `ai-assist.json`（enabled + proactivity），密钥沿用 `secret.set` |
| i18n | `i18n-data.js` 八语种 catalog | 全量新增文案按 8 语种补齐 |

---

## 1. 架构决策

1. **AI 配置复用纪要配置**：`AI 辅助` 的模型连接（provider / endpoint / api_key / model）与「会后纪要」共用 `summary-models.json`。新增一个轻量 `ai-assist.json` 只存 `{enabled, proactivity}`。避免两套 API Key。
2. **实时引擎放在 Python worker 内、独立于 ASR 主循环**：新增 `backend/worker_ai_note.py`（`AiNoteWorkerMixin`），持有专属 daemon 调度线程。ASR 主循环只做「非阻塞地喂 segment 事件 + 触发轻量检测」，绝不调用 LLM。推理优先级低于录音/ASR/笔记保存（Best Effort）。
3. **内置 AI 实时推理用专用 sidecar 实例 + 短超时 + 可取消**：现有 `_Sidecar` 是 20 分钟超时、不可中断，不满足 PRD §40/§51。为实时任务新增 `ai-note` 命名 sidecar，短超时可 kill；超时/取消时 kill 该子进程丢弃在飞请求。Qwen3 系列实时任务显式追加 `/no_think` 关闭思维链（否则思考块占满 128-token 预算、CPU 上拖慢数倍）。
4. **单飞去抖调度器（PRD §33/§52）**：一次只运行一个推理；新内容**不会打断在飞任务**（在飞结果照常使用），只在最小间隔（assist 30s / auto 16s）后把累积的新内容合并触发下一轮，避免「新触发覆盖旧任务」导致的空跑浪费。调度用 `content_version / analyzed_version` 记账：分析开始时快照版本，运行期间到达的新内容保留到下一轮。
5. **两层分离（PRD §5/§34）**：
   - 第一层「实时提议」= 本地轻量检测（规则，不调 LLM）+ 小 LLM 任务（20–80 token 输出）。
   - 第二层「上下文分析」= 用户主动触发（问会议/问工作区/整理/事实校对）+ 低频工作区关联。二者走不同入口与不同 prompt/输入预算。
6. **Meeting State 与 Raw Transcript 分离（PRD §37/§38）**：内存中维护压缩态（当前 Topic、已确认事实、决策、Action Item、待确认、用户关注点），事实校对时回查 `store.get_meeting` 的原始 segments。
7. **输入状态机放前端主导（PRD §19）**：前端以 3–5s 停笔 debounce 判定状态 A/B/C，向后端发 `ai-note.typing` 轻量信号；后端据此静默/复位触发，前端据此克制展示。

---

## 2. 阶段划分

### 阶段 0 · 配置与数据地基
- Electron：`ai-assist.json` 读写 + `ai-assist.config.get/save` IPC（Zod 校验），复用 `summary.config` 作为模型连接。
- 前端：`applyAiAssistConfig/loadAiAssistConfig/persistAiAssistConfig`，默认 `{enabled:false, proactivity:'assist'}`。
- 后端：`AiNoteWorkerMixin` 骨架 + 内存 MeetingState 容器（暂不接 LLM）。
- 文件：`electron/main.js`、`electron/preload.js`、`frontend/app.js`、`frontend/backend-client.js`、`backend/worker_ai_note.py`、`backend/worker.py`、`backend/worker_core.py`。
- 验收：配置可读可写；`app.initialize` 返回 AI 辅助状态。

### 阶段 1 · AI 辅助入口 + 空态 + 主动性设置（无需 AI 即可用）
- live 笔记区 header 右上角加 `✦ AI 辅助`（开/关态；未启用不隐藏）。
- 空态引导：启用 AI / 未启用 AI 两种文案（PRD §4）。
- 未启用点击入口 → Popover（配置 AI / 暂不），`暂不` 后不重复弹（PRD §26）。
- 设置面板新增「AI 辅助」小节：开关 + 主动性三档（安静/辅助/自动，默认辅助）（PRD §18）。
- 文件：`frontend/index.html`、`frontend/app.js`、`frontend/styles.css`（`tailwind.css` 构建）、`frontend/i18n-data.js`。
- 验收：开关、空态、Popover、三档设置在无 AI 时也完整可用。

### 阶段 2 · 无需 AI 的本地规则辅助（PRD §24）
- 基于现有字幕 + 时间戳 + 本地规则的笔记辅助：从字幕加入笔记、插入当前时间点、最近 30–60s 字幕快速插入、快速标记重点、记录待办、字幕↔笔记跳转、搜索当前字幕、选中字幕一键加入、手动工作区引用、明显数字/日期/问句高亮。
- 文件：`frontend/app.js`（live 事件与 segment 菜单）、`frontend/ui-components.js`、`frontend/styles.css`、`frontend/i18n-data.js`。
- 验收：无 AI 时整套基础笔记工作流闭环。

### 阶段 3 · 本地轻量检测 + 实时 Suggestion 引擎（后端核心，风险最高）
- `worker_ai_note.py` 实现：轻量检测器（新增长度/数字/日期/金额/决策词/待办词/风险词/问句/Topic 变化/用户停笔触发）、MeetingState 压缩更新（一条字幕只落一个列表，避免跨列表重复）、单飞去抖调度器、Suggestion 去重（归一化 + 近义模糊 + 已接受/已忽略 + 与状态条目比对）、价值门控（泛泛文本 / 裸数字 / 无数字的 number / 列表式注水 / 泛标题 topic 一律丢弃）。
- LLM 调用：内置走 `ai-note` sidecar（短超时 40s、可取消、`/no_think`），在线走 `llm_client`（短超时）；一次推理最多产出 3 条批量建议（覆盖标题/议题、观点、关键数据、待办等），逐条去重门控后发出。
- 实时 prompt 预算（CPU 优先）：MeetingState(≤420c) + 最近字幕(zh≤450c / en≤900c) + 用户段落(≤80c)；总规模控制在 ~700t（中文）以内，2B~4B 模型在 CPU 上单次分析约 5–15s。
- 事件：`ai-note.suggestion`（含 type/importance/text）；前端维护建议队列逐条展示（一次分析的多条建议不互相覆盖）。
- 取消/资源：CPU 高负载时降低频率或跳过；绝不阻塞 ASR。
- 文件：`backend/worker_ai_note.py`、`backend/worker_llama_sidecar.py`（`ai-note` sidecar 变体 + cancel）、`backend/worker_session.py`（hook segment 事件）、`backend/worker.py`、`electron/main.js`（事件白名单 + IPC）、`electron/preload.js`、`frontend/backend-client.js`。
- 验收：喂入回放字幕，能按规则触发并产出去重后的短建议；超时/取消生效；ASR 不受影响。

### 阶段 4 · 前端 Suggestion UI + 输入状态机（PRD §7–13、§16、§19）
- 三种 UI 形态：编辑器内浅灰 Suggestion、AI 建议卡（同屏至多一张）、新话题分割线（可转正式标题）。
- 输入状态机 A/B/C：打字中静默、停笔 3–5s 再评估、`✦ 1 条建议` 边缘徽标（Grammarly 式）。
- 交互：加入笔记 / 忽略 / 补充 / 修正 / 整理预览（替换/插入/取消）/ 事实校对差异提示。
- 自动淡出、不位移、信息层级弱于用户笔记。
- 文件：`frontend/app.js`、`frontend/ui-components.js`、`frontend/styles.css`、`frontend/i18n-data.js`。
- 验收：走通 PRD §28 的 7 个阶段表现。

### 阶段 5 · 第二层上下文分析 + 工作区关联（PRD §14、§20）
- 工作区历史召回（低频主动 + 用户触发）：相关会议/决策/TODO 提示「插入引用 / 查看原会议」。
- 用户主动命令：问当前会议、问当前工作区、整理零散笔记、事实校对（回查 Raw Transcript）。
- 文件：`backend/worker_ai_note.py`（第二层方法）、`backend/store_meetings.py`/`store_workspaces.py`（检索辅助）、`electron/*`、`frontend/*`。
- 验收：历史关联提示频率明显低于实时提议，仅高相关时出现。

### 阶段 6 · Onboarding AI 配置页（PRD §22）
- 离线功能配置之后新增「启用 AI 辅助」页：内置 AI / 在线 AI → Provider 高级配置（OpenAI/Anthropic/Gemini/OpenAI-compatible），再问「你希望 AI 怎样协助记录」（三档，默认辅助）。
- 复用现有 provider 配置组件；不在首页堆参数。
- 文件：`frontend/app.js`、`frontend/onboarding.js`、`frontend/styles.css`、`frontend/i18n-data.js`。
- 验收：新用户走完整 Onboarding 可完成 AI 配置；老用户从设置入口等价完成。

### 阶段 7 · 打磨 + 边界 + 全量 i18n + 测试
- 主动性「自动」档的自动整理（临时结构化笔记，明确区分用户正文）。
- Suggestion 去重/自动淡出细化、资源监控、优先级（录音>ASR>笔记保存>AI）。
- 全量 8 语种补齐、`npm test` 通过、无 AI 状态回归、PRD §29/§41/§51 边界验证。

---

## 3. PRD 章节 → 阶段映射（关键项）

| PRD | 内容 | 阶段 |
| --- | --- | --- |
| §3 笔记区结构 / ✦ AI 辅助 | header 入口 | 1 |
| §4 空态（启用/未启用） | 引导区 | 1 |
| §5 两层能力 | 实时提议 vs 上下文分析 | 3/5 |
| §6–8 实时提议/建议卡/单条 | 后端产出 + UI | 3/4 |
| §9–12 陪写/静默/四类辅助 | 输入状态机 + UI | 4 |
| §13 新话题检测 | 分割线 + 标题转换 | 3/4 |
| §14 工作区上下文 | 历史召回 | 5 |
| §16 三种 UI 形态 | 浅灰建议/卡/分割线 | 4 |
| §18 主动性三档 | 设置 + 逻辑门控 | 1/3/7 |
| §19 输入状态机 | A/B/C | 4 |
| §20 分析判断逻辑 | prompt 约束 | 3 |
| §22 Onboarding AI 页 | 新页面 | 6 |
| §24 无需 AI 基础辅助 | 本地规则 | 2 |
| §26/27 入口与文案 | Popover + 文案分层 | 1 |
| §32–41 实时推理约束 | 短任务/预算/超时/优先级 | 3 |
| §47/51/52/53/55 线程/取消/调度/去重/Reasoning | 引擎核心 | 3 |

---

## 4. 关键风险与待确认

1. **内置 AI 实时可取消性**：现有 `_Sidecar.request` 单锁 + 20min 超时，需为 `ai-note` 增可 kill 的短超时变体；kill 后 next request 自动重启（冷启动代价）。
2. **ASR 主链路保护**：轻量检测与状态更新必须 O(1)~O(n) 且无阻塞；LLM 一律在独立线程/进程。
3. **事件白名单**：`electron/main.js#workerEvent` 的 `type` 枚举需加入 `ai-note.*`，否则新事件被 Zod 拒绝。
4. **i18n 8 语种成本**：PRD 文案量大，阶段 1/2/4 需同步补齐；未补齐处先落 zh/en，其余标注 TODO 在阶段 7 收敛。
5. **配置语义**：`AI 辅助未启用` vs `纪要未配置` 是两个概念，UI 必须分离（PRD §27）。

---

## 5. 实施状态（已完成）

阶段 0–7 全部实现并验证（`npm test` 全绿：Electron 行为 + UI 结构 + 后端 154 例）。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | AI 辅助配置地基（`ai-assist.json` + IPC + 前端 config） | ✅ |
| 1 | ✦ AI 辅助入口 + 空态 + 主动性三档 + 未启用 Popover + i18n | ✅ |
| 2 | 无需 AI 本地规则：加入笔记/时间戳/快速插入/数字日期问句检测 | ✅ |
| 3 | 实时引擎：MeetingState + 轻量检测 + 单飞调度 + 去重 + 短超时可取消 sidecar | ✅ |
| 4 | Suggestion UI 三形态 + 输入状态机（A/B/C） | ✅ |
| 5 | 第二层分析：整理/事实校对/工作区召回（+ 问会议后端） | ✅ |
| 6 | Onboarding AI 配置页（8 语种） | ✅ |
| 7 | 问会议前端 + 搜索字幕 + 快速标记重点/待办 + 全量 i18n + auto 档更积极 | ✅ |

**后续可继续打磨的小项**（不阻塞核心功能）：选中字幕一键加入、手动工作区引用、auto 档「自动结构化临时笔记」的完整形态。
