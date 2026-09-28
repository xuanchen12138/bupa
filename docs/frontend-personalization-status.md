# 对话历史与健康个性化：前端状态（第一阶段）

更新日期：2026-09-28。负责：FE。依据 [实施报告](./chat-history-personalized-health-plan.md) §3–§8、§10.1。
本文只描述已经写进 `apps/web` 与 `packages/contracts` 的内容，以及实际执行过的检查；未执行的检查明确标注。

## 1. 交付范围

| 编号  | 内容                                                                                                                                                                                                                                                                | 状态                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| FE-01 | `packages/contracts/src/conversations.ts`、`personalization.ts`，主入口 `index.ts` 重新导出；旧 0.2.0 schema 迁到 `core.ts`，内容不变；`CONTRACT_VERSION = '0.3.0'`；`WizardDraft.conversationId`（可选）、`ApiError.retryable`（可选）；`fixtures.ts` 新增 `demoConversationSeed()` | 已完成，BE 的 M0 检查通过            |
| FE-02 | `apps/web/src/mock/persistence.ts`（IndexedDB 版本化快照 + 内存回退）、`history-repository.ts`（对话/消息纯函数）、`health-overview.ts`（确定性抽取、状态分类、建议规则）、`service.ts` 改为持久化并实现全部 §8.3 接口                                              | 已完成，18 个 Node 单测通过          |
| FE-03 | `stores/chat.ts` 以 conversationId 为键；新建/切换/删除/恢复/中断分开；`features/chat/history-list.tsx` 侧栏历史；`lib/api.ts` 新接口 + `features` 能力标记                                                                                                         | 已完成                               |
| FE-04 | `timeline.tsx` 按持久 entry 渲染（consent/wizard/booking 只读恢复、过期提示）；来源定位并暂停自动滚动；`wizard.ts` 记录 conversationId；提交结果写回草稿所属对话                                                                                                     | 已完成                               |
| FE-05 | `features/dashboard/health-overview.tsx`、`health-suggestions.tsx`、`use-suggestion-actions.ts`；Dashboard 顶部概览 → 建议 → 原日程                                                                                                                                  | 已完成                               |
| FE-06 | `features/profile/personalization-section.tsx`（独立开关 + 用途回执）；中英文词典 322 键对齐；query keys 与失效                                                                                                                                                       | 已完成                               |
| FE-07 | 本文、`apps/web/test/*`、`pnpm --filter @bupa/web test`                                                                                                                                                                                                              | 见第 5 节                            |

未包含：服务端接口、真实模型、跨设备同步、搜索/置顶/重命名、历史分页 UI（契约已有 cursor 字段，mock 返回 `nextCursor: null`）。

## 2. 契约要点（供 BE 消费）

- 导出名与 §8 一致：`SourceRefSchema`、`ConversationSchema`、`ConversationEntrySchema`、`ConversationTurnRequestSchema`、`ConversationStreamEventSchema`、`HealthFactSchema`、`HealthSuggestionSchema`、`HealthOverviewResponseSchema`，以及 `CreateConversationRequestSchema`、`ConversationListResponseSchema`、`ConversationMessagesResponseSchema`、`DeleteConversationResponseSchema`、`CancelTurnResponseSchema`、`PersonalizationSettingsSchema`、`PersonalizationPatchSchema`、`HealthOverviewRefreshResponseSchema`、`DismissSuggestionRequestSchema`、`StartSuggestionRequestSchema`、`StartSuggestionResponseSchema`、`ConversationErrorCodeSchema`、`PersonalizationErrorCodeSchema`。
- `ConversationEntry.consent` 比 §8 多 `dataLabel`、`benefit`、`sensitive`、`scope`（默认值可省略），用于只读恢复授权卡；不保存整份 ConsentRequest。
- `Conversation.seeded`（默认 false）标记演示植入的示例对话，UI 显示「示例」。
- `PersonalizationSettings.presetByDemo`（默认 false）：演示预置开启时为 true，UI 明示「演示预设，不代表真实同意」。
- `WizardDraft.conversationId` 为可选可空：0.2.0 生产者不写也能通过类型检查；FE 用 `?? null` 读取。提交响应可附 `conversationId`（`SubmitSchema` 允许缺省）。
- 版本：`CONTRACT_VERSION` 已升到 0.3.0；`packages/contracts/package.json` 的 `version` 仍为 0.2.0，按 §6 由 BE 在安装窗口决定是否同步（不影响 `workspace:*` 链接）。
- 错误码：`CONVERSATION_NOT_FOUND`、`CHAT_BUSY`、`TURN_NOT_FOUND`、`PERSONALIZATION_DISABLED`、`SOURCE_REMOVED`、`STALE_SUGGESTION`、`SUGGESTION_NOT_FOUND`、`GENERATION_FAILED`。HTTP adapter 保留 `code`、`status`、`retryable`（`lib/errors.ts` 的 `ApiError`）。

## 3. Mock 约定（`VITE_API_MODE=mock`，默认）

- 单一版本化快照写入 IndexedDB `my-bupa-agent-demo/snapshots`，键 `mock-state`，`SNAPSHOT_VERSION = 1`。每次变更整份写入；加载时用 zod 校验，失败进入 `corrupt` 状态并提示重置，不覆盖原数据。IndexedDB 不可用时退到内存并显示「不会保留」。
- 只在快照不存在时播种：一段示例对话（手臂受伤，`demoNow` 前 14 个本地日，语言取首次初始化时的界面语言）、个性化预置开启、一张用途回执。删除示例后刷新不会复活；「重置演示」清空快照后重新播种。
- 会话：`session.lastActiveAt` 持久化，空闲 30 分钟后视为过期——`session` 权限归 off、对应回执 revoked、未提交草稿删除、待决 consent 失效。与后端 cookie 语义一致。
- 刷新后 `latestTurn.status = running` 一律改为 `interrupted`，`tool.running → interrupted`，`consent.pending → expired`。
- 概览：`sourceRevision` 在用户消息新增（建议衍生消息除外）、对话删除、个性化开关变化时递增；facts 按 sourceRevision 缓存并记录 `generatedAt`；`snapshotRevision` 在概览重算、dismiss、start、预约关联/取消时递增。dismiss/start 校验 `expectedSnapshotRevision`，不符抛 `STALE_SUGGESTION`。
- 演示解析器（`mock/health-overview.ts`）只识别：本人手臂受伤报告（排除第三人、假设、否定、纯保障问题）；同一事项的近况更新（好转 → 已恢复 → 仍不适，依次判定，先匹配好转）；更正（撤下事项）。其他输入不产生事实。`occurredAt` 恒为 unknown（用户只说了「受伤了」）。
- 建议 id = dedupeKey = `hs-<topicKey>:<action>`。预约成功后 `prepare_gp_booking → booked`，且不再显示 `update_status`；取消预约 → `cancelled`，可重新准备（复用同一后续对话，新 `clientMessageId`）。健康状态不因预约改变。
- 删除对话：删除消息与草稿（仅该对话的）、写 tombstone、其他对话里引用它的衍生消息文本置空（UI 显示「来源已删除」）、`sourceRevision++`。已确认预约与回执保留。
- 回执、备注、提醒文案使用界面语言（`api.setLocale`），不再依赖最后一条聊天消息的语言。

## 4. HTTP 模式（`VITE_API_MODE=http`）

- `httpApi.features = { conversations: false, personalization: false, storage: 'server' }`。侧栏显示「服务端尚未启用对话历史」，Dashboard 概览显示「尚未启用」，Profile 开关禁用。对话走旧 `/api/chat`，预约闭环不变。
- 新接口的 adapter 已按 §8.3 路径实现（含 `readEventStream` 处理 CRLF/分片/残帧、按 `eventIndex` 去重）。BE 上线后把两个 `features` 改为 true 即可联调；不需要改组件。
- 未验证：本轮没有对 HTTP 模式做浏览器操作。

## 5. 实际执行的检查

| 检查                                                              | 结果                                | 说明                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `tsc -p packages/contracts`（构建 dist）                         | 通过                                | 在协作 VM 用仓库内 TypeScript 5.9.3 执行                                                              |
| `tsc --noEmit -p apps/web`、`apps/api`                            | 通过                                | api 的类型检查证明 0.2.0 生产者仍兼容                                                                  |
| `apps/api/test/personalization-contract.check.ts`                 | 通过（2/2）                         | BE 的 M0 消费检查，用 `node --experimental-strip-types --test` 运行                                    |
| `apps/web/test/health-overview.test.ts`、`service.test.ts`        | 通过（18/18）                       | 覆盖播种、刷新恢复、幂等、流中断、状态更新、dismiss、start/预约关联/取消、删除链、开关、会话过期、写失败重试、重置 |
| Prettier `--check apps/web packages/contracts`                    | 通过                                | 只格式化本轮改动文件                                                                                   |
| `pnpm build`、`vite build`                                        | **未执行**                          | 协作 VM 无 Linux esbuild 二进制；请在 Windows 上运行 `pnpm typecheck && pnpm build`                    |
| §10.1 浏览器验收                                                  | 见第 6 节                           |                                                                                                        |

运行前端单测：`pnpm --filter @bupa/web test`（Node 24 原生剥离类型；Node 22 需 `node --experimental-strip-types --test test/*.test.ts`）。测试直接导入 `src/mock/*.ts`，因此这些模块使用带 `.ts` 后缀的相对导入，并在 `apps/web/tsconfig.json` 开启 `allowImportingTsExtensions`。

## 6. §10.1 浏览器验收

（待填：以下由 FE 在 `pnpm dev` + 浏览器中逐项执行后记录。）

## 7. 需要 BE 配合 / 待办

- `packages/contracts/package.json` 版本号是否同步到 0.3.0（安装窗口）。
- `apps/web/package.json` 新增 `test` 脚本使用 Node 内置 test runner，未新增依赖；若希望进入根 `pnpm test`，由 BE 在根脚本追加 `pnpm --filter @bupa/web test`。
- HTTP adapter 已实现但未联调；BE 上线新路由后通知 FE 翻转 `features` 标记并执行 §10.2 的 FE 侧联调。
- 已知限制：mock 的诊所时段相对「当前时间」生成，跨天刷新后旧草稿中的 slotId 可能失效（会话 30 分钟过期通常先发生）；历史列表不分页；示例对话的语言按首次初始化时的界面语言固定。
