# 对话历史与健康个性化：第二阶段后端交付

更新：2026-09-28。范围为 apps/api、根配置/脚本及本页等后端文档。apps/web 与 packages/contracts 源码保持由 FE 维护。依据 [实施报告](../chat-history-personalized-health-plan.md) §8–10。

## 已实现

- 复用 contracts 0.3.0 运行时 schema，注册历史、来源读取、轮次取消、用途开关、概览刷新和建议操作接口；旧业务和裸 /chat SSE 兼容。
- SQLite v1 自动迁移、owner 作用域、稳定排序游标、历史幂等键、轮次执行状态、来源反向关联、概览版本、建议状态、最小预约提交账本。
- OpenAI Responses 的结构化分类、双语回复与事实抽取。请求固定到 https://api.openai.com/v1/responses，store=false；不注册可提交预约的模型工具。
- sourceRevision 在新增自述、删除、用途授权变化时递增；snapshotRevision 在发布和建议状态变更时递增。发布前核验授权、版本、来源及 abort 信号。
- 开启个性化建立用途回执；关闭/删除回执立即清除概览、建议及跨对话派生文本，打断任务。原始历史可继续读取，当前对话仍可继续。
- sourceRefs 使用服务端源消息 ID/时间；事实摘要仅由校验过的原文片段组成，标题采用固定中性表述，不发布模型生成的诊断标题。
- 建议只能更新近况或准备 GP；准备与双击重试复用对话/消息，创建草稿不会提交。提交、取消、改期更新建议关联，但预约不等于伤情恢复。
- 删除来源会清除依赖它的消息/概览/建议及未提交自动预填，保留用户明确确认的预约和必要记录；这些预约记录不会重新成为健康事实输入。

## 本轮实际检查

| 检查           | 结果与证据                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| 后端测试       | 90 项：原 50 项业务回归、26 项持久化/并发/联调、14 项模型客户端与授权故障测试       |
| 契约消费       | 独立 2 项检查覆盖共享 HTTP/SSE schemas 与中英历史 fixture                           |
| 真模型样例     | 19/19，通过记录见 [backend-live-eval.json](backend-live-eval.json)                  |
| 真模型预约闭环 | 4 个检查点通过，见 [backend-live-booking-eval.json](backend-live-booking-eval.json) |
| 类型与构建     | pnpm typecheck、pnpm build 通过；前端单 chunk 647.48 kB，存在体积提示               |
| 浏览器验收     | 未执行；FE HTTP 能力开关尚未打开，不将后端测试当作网页端到端验收                    |

真实模型为 OpenAI gpt-4.1-mini，所有输入为脚本内虚构数据。样例覆盖中英文他人/假设/否定、恢复/好转、更正归属、未知发生时间、多事项、历史严重描述、预约不代表恢复与提示注入。首次多事项样例出现非连续拼接引用，后端拒绝；加强连续原文约束、独立事项锚点和一次修复后复测通过。没有把第一次失败记成通过。

真实预约闭环验证：原始自述 → 真实模型概览 → 点击 GP 建议 → session 授权 → 来源预填草稿 → 四次页面推进及最终提交 → 幂等返回 → 删除原始来源，已确认预约保留、派生聊天清除。上述调用通过 Hono 请求处理器和实际 OpenAI 网络请求执行；浏览器 UI 未参与。

## 配置与迁移

参考 [.env.example](../.env.example)。本机忽略的 .env 已配置用户授权的测试密钥和 MODEL_MODE=openai。源码、文档、日志和测试结果不保存密钥。

```powershell
cd C:\Project\bupa
pnpm db:migrate
pnpm dev
```

首次启动同样自动迁移。数据库默认 .data/bupa.sqlite，Node 24 内置 node:sqlite；本机 Node 24.6.0 会显示 ExperimentalWarning。数据库采用外键、secure_delete、DELETE journal 和单进程独占连接；**一个数据库只运行一个 API 进程**。迁移、备份前停止服务；没有多实例调度或数据库加密功能。

数据表：schema_migrations、owners、conversations、entries、turns、source_edges、suggestion_state、commands、generation_jobs。owners.business 保存同一 owner 的 Profile、providers 绝对时段、已确认 bookings/notes/reminders/receipts 和最小 submissions 账本；这些与历史/建议更新在同一 SQLite 事务提交。内存业务对象在事务失败时回滚。此实现采用小型演示业务聚合，不声称已做独立业务表或生产订单系统。

旧版本没有服务端数据库，所以没有需要搬迁的旧 DB 格式；浏览器 mock 存储独立，不自动导入。数据库 schema v1 初次创建记录迁移版本，重复启动不重播 seed。POST /demo/reset 是显式重置当前演示 owner 的数据并按配置重新播种。

## 身份与恢复

默认所有本地浏览器使用 demo-lin。cookie 只控制 30 分钟临时授权和草稿，不作为长期内容 owner。createApp 的 resolveOwner 是可信服务器认证接入点；生产入口不接受 memberId、ownerId 或浏览器自报头切换会员。测试专用 resolver 验证两个 owner 的隔离；不代表已交付真实登录。

历史、用途设置、已发布概览/建议、确认预约和幂等结果在重启后恢复。所有旧 session grant 失效，未提交草稿不落盘，旧 draft GET 返回 404。运行轮次恢复为 interrupted，未完成工具/consent 标记 interrupted/expired，pending 生成恢复为 error，可显式刷新重试。已经提交的 draft 用最小 ledger 返回原预约，无需恢复原草稿正文。

## 模型输入及失败行为

- 当前用户输入和当前 conversation 有效历史允许用于当前回复。关闭个性化仍可继续当前对话。
- 开启个性化后跨对话检索最多三个相关/近期来源对话，带报告日期并包含这些对话的后续更正；建议发起时再核验指定来源。上下文不是旧报告的无条件缓存。
- 持久健康提取只读该 owner 的普通 user_input，排除助手、工具、suggestion_action 和心理健康敏感输入。心理健康当前请求先请求 session consent；其历史及派生回复在授权失效后不能复用，临时许可不会变成长久健康记忆。
- 上下文默认最多 60,000 字符；超限明确 CONTEXT_LIMIT，不静默截断、删除历史或宣称分析完全部记录。本 MVP 尚未实现长历史分批压缩/向量索引。概览最多显示三个事项和三个建议。
- 每个结构化请求默认超时 30 秒。429/5xx 最多再试一次；抽取证据不合法可修复一次，仍不合法则失败。无效 JSON、拒绝、超时、权限错误均不暗中退回 fixture 概览。
- 验证 messageId、owner、原文连续片段、事项锚点、日期证据和当前版本。主体、状态及时间含义仍依赖模型理解，不声称软件校验能证明所有医学/语义判断正确。
- 稳定事项键来自初次原文锚点；不同事项可来自同一消息。模型若改变原文锚点切分，可能识别为另一事项，这仍是后续评估点。已验证的相同锚点保留 dismiss/booking 状态。
- 当前安全信号暂停普通建议；明确过去的描述不单因危险词触发当前紧急流程。安全模块是演示规则，未经过临床验证。

store=false 不意味着供应方零保留。中断/本地删除阻止本系统继续发布或使用结果，无法撤回供应方已收到的请求。供应方处理边界按 [OpenAI 数据说明](https://developers.openai.com/api/docs/guides/your-data) 理解；本轮没有启用或声称 Zero Data Retention。应用不保存模型原始响应、请求日志或全量任务输入副本；生成任务只持久化版本与状态。

## FE 交接

1. apps/web/src/lib/api.ts 中 httpApi.features.conversations / personalization 当前仍是 false。接口就绪，FE 可启用后执行自己的浏览器验收。VITE_API_MODE=http 已写入本地 .env。
2. 历史入口使用 /conversations/:id/messages，不使用旧 /chat 获取持久能力。浏览器 mock 历史不会自动上传或迁移。
3. 个性化默认关闭；GET /personalization 返回 enabled=false。开启后查询 pending/ready/error，轮询需有限次。
4. 手工创建草稿可传 conversationId；没有传则为独立 Dashboard 草稿。改期默认沿用原预约关联。submit 响应可带 conversationId。
5. 路由、幂等和分页约定见 [联调说明](backend-integration.md)。packages/contracts 包 manifest 仍为 0.2.0，运行时 CONTRACT_VERSION 为 0.3.0；本轮保留 FE 所有权，由 FE 同步版本号。

## 最终集成检查补充

- `pnpm test`：90/90，通过；`pnpm test:personalization-contracts`：2/2，通过。
- `pnpm test:runtime`：编译后的独立 API 进程、真实 TCP HTTP/SSE、连续两次迁移及进程重启恢复通过。使用临时 SQLite/随机端口，不操作正在联调的数据。
- 本机 `http://127.0.0.1:3001/health` 已实际返回 `modelMode=openai`、`model=gpt-4.1-mini`、`storage=sqlite`、两项新能力为 true；已有开发服务器已自动加载本轮实现。
- 该服务器独占实际数据库，因此同时运行根 `pnpm db:migrate` 被 SQLite 的占用检查拒绝。没有停止用户现有服务；已用独立库验证迁移及幂等。再次手动迁移须先停止 API，日常启动不需要重复执行迁移命令。
- `pnpm --filter @bupa/web test`：18/19 通过，失败为 `apps/web/test/service.test.ts:336` 的 idle session reload 用例；预期 postcode permission 为 off，实际为 session。该用例运行浏览器 mock 服务，本轮未修改对应前端实现，需 FE 修复并复测。
- 后端实际重启、session 失效和授权隔离测试均通过；不能将前端 mock 的失败或其余测试当作 HTTP 浏览器验收。
