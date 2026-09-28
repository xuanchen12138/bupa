# 对话历史与健康个性化：后端状态与持久化设计

更新日期：2026-09-28。范围：第一阶段的 BE-01 配套检查、BE-02 设计与 BE-03 状态交接。
依据：[实施报告](../chat-history-personalized-health-plan.md) §5、§8、§9，以及当前 `apps/api` 源码。
本文中的表、迁移与事务均为**第二阶段待实现设计**，不代表数据库、新接口或真实模型已经上线。

## 1. 当前完成情况与依赖

| 项目               | 当前状态             | 判定边界                                                                        |
| ------------------ | -------------------- | ------------------------------------------------------------------------------- |
| 既有后端           | 已有内存演示业务     | 授权、预约、取消改期、SSE 和 ScriptedLLM；重启后恢复 fixture                    |
| BE-01 契约消费检查 | 已通过并反馈剩余约定 | 正式导入 19 项核心及 HTTP schema、中英手臂 fixture；不在后端另造 DTO            |
| M0 契约冻结        | 最终冻结待确认       | 运行时 CONTRACT_VERSION 为 0.3.0，package.json 仍为 0.2.0；剩余约定见第 2 节    |
| BE-02              | 本文完成设计         | 未安装数据库依赖、未创建迁移、未实现持久层                                      |
| BE-03              | 已完成文档校正       | README、architecture、backend-integration、implementation-plan 与配置注释已更新 |
| 历史与健康新接口   | 未实现               | 旧 `/chat` 及既有业务接口继续保留；不能据此宣称新 HTTP 能力可用                 |
| 真实模型           | 未接入               | 不把当前 ScriptedLLM 或未来 fixture 概览称为真实历史理解                        |

独立检查为 [`personalization-contract.check.ts`](../apps/api/test/personalization-contract.check.ts)。
命令为 `pnpm test:personalization-contracts`，不加入原有 `pnpm test` 的回归集合。
2026-09-28 最终检查为 2/2 通过：19 项共享 schema 的 HTTP/SSE 样例、必需元数据和拒绝非法输入；固定时钟下中英文 demoConversationSeed 的解析、ID/排序、来源及 14 个本地日前的日期。
初次检查时 FE 新导出尚未发布，曾明确失败；同轮 FE 加入导出后已重新消费，不能继续把“缺八项”作为当前结论。
新消费检查和旧 API 回归分别运行；它们不证明 Repository 事务、浏览器刷新/删除或真实模型已经实现，也不替代双方最终冻结业务约定。
本轮没有修改生产 API 逻辑；改动范围为新增检查、脚本、说明文档及环境配置注释。

| 实际检查                                       | 执行结果                 | 证据与范围                                              |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `pnpm test:personalization-contracts`          | 2/2 通过，无 skip        | 19 项 schema 与中英共享 fixture；运行时契约 0.3.0       |
| `pnpm test`                                    | 50/50 通过，无 skip      | 2026-09-28 根任务执行；原有业务回归，不包含独立 M0 检查 |
| `pnpm typecheck`                               | 通过                     | 2026-09-28 根任务执行；类型检查不证明新接口存在         |
| `pnpm build`                                   | 通过，有前端体积 warning | 最新契约下重新构建；web 单 chunk 558.01 kB              |
| 本轮 BE 文件格式检查                           | 通过                     | 仅本轮后端检查器、manifest 和五份说明文档               |
| 根 `pnpm check`                                | 未通过，停在格式检查     | 下列四个 FE 所有文件存在格式差异；后续检查已分项执行    |
| 浏览器、数据库、重启恢复、新历史 API、真实模型 | 未执行                   | 无相应端到端或运行验证结论                              |

最后一次全仓格式检查报告：`apps/web/src/lib/errors.ts`、`apps/web/src/mock/history-repository.ts`、`apps/web/src/mock/persistence.ts`、`packages/contracts/src/personalization.ts`。这些是 FE 并行修改的文件，BE 未代为格式化；不是后端功能测试失败。类型、50 项既有测试及构建均已在新契约出现后另行重跑通过。以上是本次检查时的工作区快照，后续 FE 改动需再次集成验收。

## 2. FE 契约消费结果与待冻结项

- 八项核心 schema 已消费通过：SourceRef、Conversation、ConversationTurnRequest、ConversationEntry、HealthFact、HealthSuggestion、HealthOverviewResponse、ConversationStreamEvent 对应的 Schema 导出。无需独立导出组合用的 EntryBaseSchema。
- 十一项 HTTP schema 已消费通过：CreateConversationRequest、ConversationListResponse、ConversationMessagesResponse、DeleteConversationResponse、CancelTurnResponse、PersonalizationSettings、PersonalizationPatch、HealthOverviewRefreshResponse、DismissSuggestionRequest、StartSuggestionRequest、StartSuggestionResponse 对应的 Schema 导出。单条消息复用 ConversationEntrySchema。
- demoConversationSeed 与 DEMO_ARM_* 常量已发布并消费。新增 seeded/presetByDemo 默认值兼容旧调用；consent entry 的 dataLabel/benefit 必填字段可由服务端已有 consent 记录提供，检查已覆盖。
- 运行时 CONTRACT_VERSION=0.3.0，但 package.json 版本尚为 0.2.0，需要 FE 同步 manifest 并确认最终冻结。当前 workspace:* 使用 link，未新增依赖，本轮无需改锁文件；后续安装仍由 BE 统一执行。
- 分页响应已有 schema；分页 query 的 limit 默认 30、上限 100 及非法 cursor 行为尚需统一。BE 路由应在 owner 范围验证，不以 cursor 作为授权。
- occurredAt.value 目前只接受 ISO datetime：日期级自述须统一时区/标准化方式，并保留 precision=day；不得把精度提升为用户没有提供的时刻。
- 手动创建 draft 的可选 `conversationId`、`originSuggestionId` 等关联 metadata：字段名、可空语义和绑定时机待冻结；客户端只提交引用，由服务端核验归属。
- WizardDraft 已有可选 conversationId，但创建请求的绑定协议及 revision 尚待统一；服务端不能由当前选中的聊天推断预约归属。
- interrupted 后的**用户明确重试**与**自动网络重试**如何区分待冻结；建议显式 retry 标记或独立请求，关联原 turn。复用 clientMessageId 的网络重试不能自行重新执行副作用。
- `sourceRefs` 必须覆盖派生 assistant 文本和 suggestion-action 提示；服务端内部另记字段级来源，不把模型生成的提示当成新用户伤情证据。
- ApiError 已支持可选 retryable；当前前端 HTTP adapter 仍需保留 code/status，并新增 conversation SSE 外壳解析、分片/CRLF、去重和断流恢复。这些是第二阶段联调依赖。
- 完成类型与 fixture 消费后，仍须双方确认上述剩余协议才记录 M0 最终冻结；当前不据此启用新 HTTP 路由。

## 3. Owner、session、conversation 与 draft

| 标识             | 服务端责任                                                       | 生命周期                                                |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| ownerId          | 决定内容及业务记录归属；由可信身份解析器注入 Context             | 不随 cookie 到期；当前只能固定为明确标记的 Lin 演示身份 |
| cookie sessionId | 临时字段授权、执行请求、草稿校验；关联 owner                     | 保留现有 30 分钟空闲 TTL                                |
| conversationId   | 长期历史归属 owner，跨多个 session 阅读和继续                    | 保存至删除，不能作为访问凭据                            |
| turnId           | 关联 owner、conversation、执行 session、状态及执行代号           | 内容持久，运行控制器不持久                              |
| draftId          | 关联 owner、可选来源 conversation、执行 session、进度及 revision | 有效会话内编辑；过期草稿不可继续                        |
| bookingId        | 关联 owner 与最小提交结果；来源对话可解除                        | 删除聊天不取消已确认预约                                |

Repository 每个方法接收服务端 owner，不能依赖请求方的 memberId，也不能只检查对象 ID 存在。
查询和写入均使用 owner 条件；其他 owner 的对象与不存在对象使用同类不可访问响应，不泄露存在性。
数据库使用 `(owner_id, id)` 唯一键和同 owner 的复合关联；conversation、entry、draft、booking、source 引用不能跨 owner。
`openDraftId` 同时验证 owner、执行 session、请求 conversation；同 session 的另一段聊天也无权自动占用该草稿。
独立手动创建的草稿允许无 conversation；关联需要明确操作，聊天不能仅凭 ID 自动认领。
重开历史不迁移旧 sessionId、不恢复旧 session grant。建议旧草稿显示 expired，用户选择重新准备时创建新草稿。
当前所有浏览器共享 Lin，cookie 不是会员登录认证；加入 owner 列也不等于具备真实多租户认证。
阶段二须一并改造现有 receipts、notes、reminders、schedule 和取消预约查询，不能只隔离新增历史接口。

## 4. 建议持久表、索引与运行时状态

以下是逻辑表设计，具体迁移 SQL 和驱动待第二阶段确定；业务表默认包含 owner_id。

| 表组                                  | 关键数据                                                                           | 约束或索引                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| schema_migrations / demo_state        | schema version、seed version、demoNow、初始化标记、reset generation                | 初始化标记与 seed 原子写入；空历史不触发重新 seed                    |
| owners / profile_fields               | 演示/会员模式、字段值、持久字段权限                                                | `(owner_id, field)` 唯一；临时权限另存运行域                         |
| conversations                         | 标题、时间、创建 requestId、activeDraftId、删除/执行代号                           | `(owner_id, request_id)` 唯一；列表索引 `(owner_id, updated_at, id)` |
| turns                                 | conversation、用户消息引用、attempt/requestId、执行 session、状态、执行代号        | 对话内 attempt/requestId 唯一；有效执行用条件更新认领                |
| conversation_entries                  | 稳定 entryId/order、kind、正文或实体引用、origin                                   | `(owner_id, conversation_id, order)` 唯一；用户 clientMessageId 唯一 |
| drafts / draft_fields                 | 对话、执行 session、step、confirmedProgress、revision；字段 value/source/confirmed | owner 复合关联；字段来源可反向清除                                   |
| bookings / booking_commands           | 最终预约快照；draft→booking/receipt 的最小提交结果                                 | `(owner_id, draft_id)` 唯一；command 不保存整份原始请求              |
| provider_slots / slot_reservations    | 稳定绝对时间、provider、有效占位                                                   | 有效时段占位唯一；同 provider 的重叠区间在事务内检查                 |
| reminders / notes                     | booking、用途、来源、用户确认情况                                                  | `(owner_id, booking_id)` 索引；不以 createdBy 代替来源               |
| receipts / consent_records            | action/data 元数据、范围、状态、session 引用与失效时间                             | 业务命令回执幂等；不复制症状正文                                     |
| personalization_state                 | enabled、sourceRevision、snapshotRevision、receiptId、授权版本                     | owner 唯一；所有相关变更使用原子 revision 更新                       |
| health_facts / source_edges           | 已验证自述、源消息、目标对象/字段                                                  | 来源反向索引；源和目标均有同 owner 关联                              |
| health_snapshots / health_suggestions | 同一发布快照、稳定 dedupeKey、dismiss/booked 状态、实体引用                        | `(owner_id, dedupe_key)` 稳定；快照 revision 单调                    |
| generation_jobs                       | owner、目标 sourceRevision、状态、执行代号                                         | 同 owner/源版本的有效任务去重；默认不持久化完整模型输入              |

source_edges 的多态目标应拆为有外键的关系表，或使用统一内容实体登记表；不能仅存未校验的自由 ID 字符串。
来源索引覆盖事实、摘要、建议、派生消息、自动预填和自动备注，不能只索引 HealthFact.sources。
message order 与 SSE eventIndex 分别分配，工具 running/done 更新同一 entry，不新增排序位置。
clientMessageId 对用户消息去重；明确 retry 若创建新 turn，应另有 attempt/requestId 并关联原消息，不能误将 clientMessageId 设为所有 turn 的唯一键。
分页游标只携带排序边界和版本等元数据，不包含健康文本；解码后仍以当前 owner 查询。

**会话恢复选择：**建议 MVP 不持久化可恢复 session/grant；进程重启使全部旧会话失效。
可以持久化必要的授权审计元数据，但它不赋予权限；启动时将 session 范围回执/consent 标为失效。
AbortController、Promise、waiter、SSE writer、事件监听器和临时推荐缓存均只在运行时存在。
持久 turns/jobs 的 running 状态是恢复线索，不是可直接恢复的进程锁或有效授权。

## 5. 事务、版本和迟到结果

| 操作       | 同一事务的边界                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 接受新消息 | 校验 owner/来源/session、请求幂等；写 user entry 与 turn、分配 order、更新对话时间及相关 sourceRevision；提交后发 turn_accepted |
| 展示事件   | 检查 conversation 未删、turn 执行代号有效；保存/更新 entry 后发送 SSE，不只在 done 落盘                                         |
| draft 编辑 | 核验 session/归属/revision，修改字段并降低必要确认进度；条件更新失败要求重新读取                                                |
| 提交预约   | 核验 draft、授权、来源、安全规则和时段；写占位、booking、receipt、提醒、备注、提交账本、对话 booking 引用和建议关联             |
| 改期       | 新预约成功与旧预约取消、旧提醒禁用、回执变化一起提交；失败保留旧预约                                                            |
| 取消预约   | booking 状态、提醒、取消回执、建议状态、snapshotRevision 一起提交；重复调用不创建第二份回执                                     |
| 取消 turn  | 标记 interrupted、废止执行代号、结束本轮 pending consent；重复调用返回当前终态                                                  |
| 发布概览   | 再验 sourceRevision/授权/来源；概览和建议在同一 snapshotRevision 原子发布                                                       |
| 删除/撤权  | tombstone/权限/版本更新、派生清理、草稿失效同一业务事务；返回新 revision                                                        |

模型调用和网络写入不放在数据库写事务内。读取受限输入、调用模型、条件发布分成三个步骤。
事务应短；MVP 单实例可利用单数据库写事务串行化关键命令，但仍保留条件更新和唯一约束。
Abort 只负责尽快停止计算；每次提交还要检查执行代号、tombstone、sourceRevision，才能防止迟到写入。
sourceRevision 对相关用户信息新增/修正、来源删除和用途授权变化递增，不因每条工具进度反复递增。
snapshotRevision 对概览发布、dismiss、建议预约关联等展示状态递增；这些操作未必改变来源版本。
生成任务发布时重新加载稳定 dedupeKey 对应的最新 dismissed/booked/cancelled 状态再合并，或对 snapshotRevision 做冲突重试。
只校验 sourceRevision 会让慢生成覆盖刚发生的 dismiss，因此不能用旧 suggestions 数组直接覆盖当前状态。
suggestion start 在事务中验证 expectedSnapshotRevision、有效来源、owner 和 requestId；只创建/复用专用对话，不创建预约。
生成的 clientMessageId 随 start 结果持久化；发送失败后重复点击继续同一对话和幂等消息。
同 clientMessageId 的自动重试读取已完成结果，running 返回当前状态/CHAT_BUSY；interrupted 不自动重执行，等待明确 retry 协议。

删除与提交竞争：删除先提交，则 draft 后续操作失败；预约先提交，则删除保留已确认预约并解除来源引用。
旧执行不得在删除后重建对话或写 booking 时间线；已完成业务结果通过 owner 范围的业务实体读取。
独立取消预约与取消模型 turn 是两种命令；切换聊天中断生成不自动取消预约。

## 6. 历史、授权和删除链

保存聊天、允许跨对话个性化、允许某字段/敏感类别用于本次服务，是三个独立决定。
个性化默认关闭；开启不升级 Profile 权限，也不将 mentalHealthNeed 变成 always。
关闭个性化保留可阅读聊天，删除事实/概览/建议及相关跨对话派生上下文；普通同对话续聊仍可使用该对话有效历史。
原始 source 被删除或特别权限失效时，同对话续聊也必须过滤受影响内容，不能通过旧摘要把信息带回模型。

删除来源对话需要清理：

1. 阻止其新 turn/写入，增加删除与执行代号；尽快 abort 相关任务，但正确性依赖事务检查。
2. 删除源标题、正文、翻译、handoff 摘要及持久事件内容，只留不含正文的 tombstone/必要幂等 ID。
3. 沿 source_edges 删除事实、证据、概览、建议及其他聊天中的派生摘要和 suggestion-action 提示。
4. 多来源事实先撤下完整旧表述，再按剩余有效来源重建；不能只删一条 sourceRef 却保留其独有细节。
5. 清除关联未提交草稿及自动预填；其他独立草稿仅清除受影响来源字段，保留无关用户输入。
6. 清除模型上下文缓存、持久任务输入及未来检索索引中的派生内容；禁止生成任务把旧数据写回。
7. 同事务增加 sourceRevision/snapshotRevision、解除来源关联，提交后返回新版本；FE 移除敏感缓存，而非仅 invalidate。

其他对话中用户后来独立明确报告的新情况可以保留；建议自动生成的提示、助手复述和翻译不是独立新证据。
撤销 Profile 字段权限继续清理非用户来源预填及相关推荐；撤销敏感权限还清理对应敏感派生上下文。
sourceRefs 从模型返回后必须验证确属输入和当前 owner，证据片段存在且来源仍获准使用。
通用日志、分析事件、URL、错误和回执不保存健康正文。删除成功不等于能撤回供应商已接收的请求。
若以后保留备份或任务输入，须明确其删除/恢复策略；恢复备份应重放删除状态，不复活被删内容。

## 7. 已确认预约保留的精确定义

| 数据                                                   | 删除来源聊天后的处理                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 已确认预约 ID、provider/slot、服务、状态与必要就诊资料 | 保留在预约用途域，解除聊天/建议来源联系，不加入个性化检索                    |
| 用户最终确认的 need                                    | 若明确列为预约履行所需，可保留预约快照；删除说明需告知已确认预约资料另行保留 |
| 必要 action receipt                                    | 保留动作、时间、状态、bookingId 和必要用途；不保留聊天正文/模型输入/证据摘录 |
| 预约时间提醒和通用携带清单                             | 随有效预约保留；取消预约时禁用相关提醒                                       |
| 含健康描述的自动备注或提示                             | 仅明确纳入用户确认预约资料的内容保留在预约域，其余沿来源删除                 |
| submitted draft 的完整 fields                          | 清除敏感 payload，以最小提交结果账本支持幂等                                 |
| 历史中的 booking/receipt 引用                          | 随历史条目删除；保留的业务实体不反向成为健康来源                             |

建议内部记录 retentionPurpose、confirmedForAction 和 sourceRefs；单靠 createdBy=ai/user 无法实施上述区别。
现有 submitDraft 重试依赖完整 submitted draft，需拆为 owner+draftId→bookingId/receiptId 账本。
成功结果可按 owner 读取，但不能借由读取结果恢复过期 draft 的编辑权限或重新执行提交。
对话删除不取消预约；取消预约仍用显式业务入口，也不代表用户已经康复或可自动重新推荐同一预约。

## 8. 迁移顺序与重启恢复

1. 冻结 M0 与 Repository 端口，保留内存实现作既有业务测试基线；不改 FE contracts 的所有权。
2. 增加 migration runner、数据库 schema version、seed 标记和可信演示 owner；驱动/版本集中确认后安装。
3. 先持久化业务引用所需的 Profile 持久权限、预约/回执/提醒/备注、时段占位与最小提交账本。
4. 再接入 conversation/turn/entry/provenance，验证重启后引用存在、owner 隔离与消息幂等。
5. 接入个性化设置、来源与快照修订、事实/建议/任务，先验证事务、删除和恢复，再接真实模型。
6. 最后显式启用新 HTTP 能力；第一阶段浏览器演示数据不自动上传，HTTP 使用自己的已标记 fixture。

当前 demoProviders(clock()) 每次启动重建时段，而 slot ID 只有 provider/dayOffset/hour，会让同 ID 对应不同日期。
持久层必须冻结 demoNow/已生成 slots，或改用包含绝对时间的稳定时段键；预约保留独立 provider/slot 快照。
不要直接序列化整个 DemoStore：这既遗漏 session/进度/幂等关联，也会保留不应长期保存的草稿和控制对象。
启动恢复先完成 migrations，再令旧会话无效、pending consent 过期、未完成 turns/jobs interrupted、旧 draft 失效并清临时预填。
然后提供 owner 范围的持久历史和业务读取；恢复 GET 不重发 prompt、不执行旧授权卡、不重新提交预约。
初始化与 seed 在事务中提交，普通重启或删空历史不重播示例；reset 是独立演示域清除操作，并使旧任务代号失效。
迁移不能声称找回当前进程已丢失的内存预约；阶段二切换时应明确新数据库起点和导入范围。
现有 action receipt 的“重启清除”文案须随真实持久化修改，不能仅改变存储却保留旧承诺。

## 9. 配置、命令与后续验收边界

目前新增可执行命令只有本任务所述 `pnpm test:personalization-contracts`；实际运行记录见第 1 节。
数据库路径、迁移命令、历史能力开关、模型供应方配置及任务重试配置尚未实现，也未确定最终名称。
不提供不存在的启动/迁移命令，不修改当前 DEMO_MODE 支持范围，不将密钥放进 VITE_ 变量。
第二阶段至少验收：跨 owner 访问、重启后业务引用、消息/提交幂等、删除与提交竞争、撤权阻断迟写、dismiss 不被生成覆盖。
还须验收：源删除后所有派生副本清除、独立新证据保留、会话过期不恢复授权、旧 booking 保留且不进入个性化上下文。
本设计不证明持久化、并发或真实模型已经通过测试；BE-02 完成不解除 M0 和第二阶段实现依赖。
