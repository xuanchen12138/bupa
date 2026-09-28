# 后端与前端联调约定

本页根据当前 `apps/web/src/lib/api.ts`、相关调用方及 `packages/contracts/src` 的 0.2.0 契约整理。前端和共享契约由前端团队维护；后端适配这些文件，不直接修改它们。本轮范围为演示后端：离线 `ScriptedLLM`、虚构保障与诊所、模拟预约，不接真实模型、真实保单、真实预约或付款系统。

后端使用内存保存状态，服务重启后恢复 fixture；没有数据库持久化。以下约定适用于默认登录的 Lin 演示会员，不是生产多会员鉴权接口。

## 本次个性化优化的阶段边界

按根目录 [优化说明](../chat-history-personalized-health-plan.md) 第 7.2 节，后端第一阶段交付契约消费检查、owner/session/conversation/draft 关联及持久化删除设计、现有文档校正。设计和待前端冻结的接口见 [后端个性化状态](backend-personalization-status.md)。

共享契约运行时已加入 0.3.0 的历史/健康 schema，并保留既有业务结构兼容；package.json 版本同步及最终 M0 约定仍待确认。根目录 `pnpm test:personalization-contracts` 已实际通过 19 项共享 schema 与中英手臂 fixture 消费检查，独立于现有 `pnpm test` 回归。它不代表历史 HTTP 接口、数据库或完整 M0 已完成；剩余字段/协议反馈见后端状态文档。

现有 `/chat` 保持裸 `ChatEvent` 和临时 cookie 会话语义。`/conversations`、`/personalization`、`/health-overview`、`/health-suggestions` 及其子路径尚未注册，当前返回 JSON 404，不能用于第一阶段的历史演示。前端第一阶段使用浏览器 mock；HTTP 新能力、数据库迁移与真实模型属于第二阶段，不需要本轮配置模型 key 或数据库。

未来 conversation SSE 另加 `conversationId/turnId/eventIndex/at/entryId/payload` 外壳；不会把旧 `sessionId` 当作 conversationId，也不会改变旧 `/chat` 的格式。HTTP adapter 后续需保留错误 code/status，并支持新流的归属、分片、CRLF 和断流恢复。第一阶段后端不自动存聊天、不生成跨对话健康记忆，也不把浏览器演示数据上传模型。

## 开发连接

前端默认使用浏览器内的 MockService。联调时在项目根目录启动开发服务前设置：

```powershell
cd C:\Project\bupa
$env:VITE_API_MODE = 'http'
pnpm dev
```

也可以在项目根目录的本地 `.env` 中设置 `VITE_API_MODE=http`，然后重启 Vite。浏览器统一访问 `/api/*`。Vite 将请求转发到 `http://127.0.0.1:3001`，并去掉 `/api` 前缀。因此表中的浏览器路径 `/api/profile` 对应 API 服务的 `/profile`。端口可通过根目录环境变量 `PORT`、`WEB_PORT` 配置。

## JSON 接口

成功响应直接返回共享 Zod Schema 对应的对象，不额外包装 `data`。请求正文均为 JSON；下表的“无”表示调用方不发送正文。失败响应至少为 `{ "error": { "code": "...", "message": "..." } }`。目前 HTTP adapter 只提取 `error.message`。

| 方法   | 浏览器路径                 | 请求正文                                                                                   | 成功响应                                             |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| GET    | `/api/health`              | 无                                                                                         | `HealthResponse`                                     |
| GET    | `/api/profile`             | 无                                                                                         | `ProfileResponse`                                    |
| PATCH  | `/api/profile`             | `{ fields: { [profileField]: string } }`                                                   | `ProfileResponse`                                    |
| PATCH  | `/api/profile/permissions` | `{ field, permission: 'off' \| 'session' \| 'always' }`                                    | `ProfileResponse`                                    |
| GET    | `/api/receipts`            | 无                                                                                         | `Receipt[]`                                          |
| DELETE | `/api/receipts/:id`        | 无                                                                                         | 更新后的 `Receipt[]`                                 |
| GET    | `/api/schedule`            | 无                                                                                         | `Schedule`                                           |
| POST   | `/api/bookings/:id/cancel` | 无                                                                                         | 更新后的 `Schedule`                                  |
| POST   | `/api/reminders`           | `{ bookingId: string \| null, text: string, at: ISO日期时间 }`                             | 更新后的 `Schedule`                                  |
| PATCH  | `/api/reminders/:id`       | `{ enabled: boolean }`                                                                     | 更新后的 `Schedule`                                  |
| POST   | `/api/notes`               | `{ bookingId: string \| null, text: string }`                                              | 更新后的 `Schedule`                                  |
| POST   | `/api/cards/:id/dismiss`   | 无                                                                                         | 更新后的 `Schedule`                                  |
| GET    | `/api/providers/:id`       | 无                                                                                         | `Provider`；不存在时为 JSON `null`                   |
| POST   | `/api/providers/search`    | `{ service, postcode: string \| null, language: string \| null, telehealthOnly: boolean }` | `{ providers: Provider[], rankingNote: { en, zh } }` |
| POST   | `/api/wizards/booking`     | `{ prefill?: Record<string, WizardFieldValue>, rescheduleOf?: string \| null }`            | `WizardDraft`                                        |
| GET    | `/api/wizards/:id`         | 无                                                                                         | `WizardDraft`                                        |
| PATCH  | `/api/wizards/:id`         | `{ fields?: Record<string, WizardFieldValue>, step?: number }`                             | 更新后的 `WizardDraft`                               |
| POST   | `/api/wizards/:id/submit`  | 无                                                                                         | `{ booking: Booking, receipt: Receipt }`             |
| DELETE | `/api/wizards/:id`         | 无                                                                                         | 可返回 HTTP 204                                      |
| POST   | `/api/consent`             | 下述 consent 创建正文                                                                      | `ConsentRequest`                                     |
| POST   | `/api/consent/:id`         | `{ decision: 'session' \| 'always' \| 'deny' }`                                            | `{ request: ConsentRequest }`                        |
| POST   | `/api/chat`                | `{ sessionId, message, uiLocale: 'en' \| 'zh', openDraftId: string \| null }`              | 下述 SSE 流                                          |
| POST   | `/api/demo/reset`          | 无                                                                                         | 可返回 HTTP 204                                      |

创建 consent 的正文包含 `fields: string[]`、`sensitive: boolean`、`dataLabel`、`purpose`、`benefit`、`excludedUses: string[]`、`retention`、`allowedScopes: ('session' | 'always')[]` 和 `wizardFieldId: string | null`。`id`、`sessionId`、`status` 由后端产生。字段内联授权和聊天授权使用相同的响应接口。

`Schedule` 必须包含 `bookings`、`reminders`、`notes`、`drafts`、`cards`；创建、取消、改期、撤回授权后的结果应能通过这些读取接口重新获取。HTTP 模式的 `subscribe()` 是空实现，界面依赖操作成功及 SSE 事件触发的 query invalidation。

## 会话与 SSE

后端采用服务器生成的 `bupa_session` cookie 标识会话，属性为 HttpOnly、SameSite=Strict、Path=/。浏览器经 Vite 同源代理发出的 fetch 默认携带 cookie，不需要前端新增请求头。当前聊天 store 发送的 `sessionId` 固定为 `session-demo`；它只是前端兼容标签，不能作为状态访问凭据。后端使用 cookie 约束本次授权、草稿、待决 consent 和正在运行的对话。同一演示会员的 Profile、预约和回执是共享的；此 cookie 不代表真实会员登录认证。

会话空闲有效期为 30 分钟，每次请求刷新有效期。过期或显式关闭会话后，本次授权失效，未提交草稿清除，会话授权回执保留为 revoked；always 权限保留，直到用户撤回或重置演示。JSON 请求正文上限为 64 KiB。

聊天是 `POST /api/chat` 的 fetch 流，响应类型为 `text/event-stream`。每个事件的数据是符合 `ChatEventSchema` 的完整 JSON，例如：

```text
data: {"type":"tool_status","id":"tool-1","tool":"get_cover","status":"running","label":"正在读取保障"}

data: {"type":"message","id":"message-1","text":"演示回复","translation":null,"suggestions":[]}

data: {"type":"done"}

```

事件必须使用 LF 换行并以 `\n\n` 结尾；当前 parser 不会处理 CRLF 分隔或流关闭时残留的半个事件。`type` 在 JSON 内，不能只写在 SSE `event:` 行里。未通过共享 schema 的事件会被前端忽略。`done` 之后还需要结束响应，否则聊天 UI 会继续保持 running。

授权暂停时保留同一个 SSE 响应：

1. 后端先登记待决请求，再发出 `consent_request`。若用户的决定先于等待者到达，后端保存该决定，等待者直接读取，避免快速点击造成丢失。
2. 用户点击授权按钮，前端单独 POST `/api/consent/:id`。
3. 原聊天流继续发送 `consent_resolved`；授权成功时发送 `receipt`；随后继续原工具或生成 `wizard_open` / `wizard_prefill`。
4. 发出 `done` 并关闭响应。拒绝授权也必须能走到可用的替代路径和正常结束。

前端不会再次发送聊天请求来恢复授权后的工作。授权等待上限为 120 秒，超时按拒绝处理；流中每 15 秒发送保活内容。中断、重置和超时释放等待者，防止后续意外恢复已放弃的工作。同一工具的 running/done/blocked 更新使用相同 `id`，界面才会更新原来的进度行。

## 后端额外接口

以下接口已由后端提供，但当前前端 adapter 没有直接调用：

| 方法 | API 服务路径       | 用途                                        |
| ---- | ------------------ | ------------------------------------------- |
| GET  | `/covers/:service` | 读取对应服务的模拟保障，不存在时返回 `null` |
| GET  | `/reminders`       | 读取提醒数组                                |
| GET  | `/notes`           | 读取备注数组                                |
| POST | `/session/close`   | 关闭当前 cookie 会话并清除 cookie，返回 204 |

POST `/demo/reset` 清除所有演示会话、等待中的 SSE 授权、权限变更、草稿、预约、备注、提醒和回执，再重新加载 fixture，返回 204。它只重置内存中的演示状态，不修改契约、源码或其他项目文件。前端重置入口应同步清空聊天/向导本地状态，并重新获取 Profile 与 Schedule。

## 向导和 Dashboard 细节

- 向导字段名及来源由 `@bupa/contracts/wizard` 定义。常用字段为 `serviceType`、`need`、`postcode`、`providerId`、`slotId`、`patientName`、`memberNumber`、`phone`、`language`、`interpreter`、`notes`、`reminder` 和 `reminderLead`。不要使用其他旧版本字段名。
- `WizardFieldValue` 仅支持 string、boolean、number、null。`whatToBring` 在草稿里是使用 `·` 分隔的字符串；提交后的 `Booking.whatToBring` 是字符串数组。
- 用户编辑通过 PATCH 发送裸字段值；后端生成 `source` 和 `confirmed`。模型只能调用内部字段预填能力，不能修改 step、status 或直接提交预约。
- 前端下一步按钮一次推进一页；返回按钮可以回到之前的页面。后端需验证必要字段、服务与医生类型、时段归属和状态，最终提交不能只依赖前端是否显示按钮。
- POST submit 没有额外 confirmation 正文；调用该独立提交接口本身是当前协议的用户行动边界。成功后前端会把 `{ booking, receipt }` 写入当前对话，不依赖聊天流再次广播预约完成。
- 改期通过 POST `/api/wizards/booking` 的 `rescheduleOf` 创建草稿。原预约应在最终提交成功后才被取消；提交失败或放弃草稿不能影响原预约。取消和改期需要同步原预约提醒。
- `/schedule` 保留 `status=cancelled` 的预约用于查看记录；前端 Upcoming 列表只显示 confirmed，周/月历将 cancelled 项显示为灰色删除线。
- Profile 中 permission=off 仍允许用户自己看到和编辑其数据；限制的是 AI 使用、自动预填和推荐。用户手动输入向导字段应有独立的 `user` 来源。
- 撤回授权应清除未提交草稿中依赖该授权的自动预填，并使依赖旧位置的诊所和时段重新选择。不要悄悄清掉用户手动输入的值。
- `session` 授权必须核对当前后端会话；敏感授权不得通过伪造 `allowedScopes` 获得永久权限。重复授权或重复提交应避免生成重复预约和回执。
- fixture 中电话为 `04xx xxx 123`，会员号为 `DEMO-4D-000123`，均为演示数据。校验应识别当前演示边界，不能因为真实电话号码格式约束阻断整个主流程。
- Providers 为虚构诊所；时段相对生成时间计算。后端需要复用一致的时段快照，保证搜索、读取和提交使用同一组时段。

## 前端适配限制

HTTP adapter 目前把验证失败转为普通 `Error`。向导字段高亮逻辑只识别 mock 的 `ValidationError`，因此后端错误信息需要足够明确；后续前端可读取额外的字段/步骤信息来恢复同等高亮体验。

Provider picker 固定发送 `telehealthOnly: false`，再结合服务类型、postcode 和 `acceptTelehealth` 在 UI 中筛选。后端正确执行显式 `telehealthOnly: true`，并在没有位置时提供无需位置的路径。若没有 Profile 使用权限，直接传入非空邮编/语言会返回 403；用户已在本会话未提交草稿中手动填写的同值筛选可用于这次搜索，不会授予 Profile 权限，模型工具也不能使用这个例外。当前 fixture 没有牙科诊所，因此牙科搜索可以返回空列表，不能借用 GP 时段构造牙科预约。

手动选择心理健康服务还有一个前端接入点：在第 1 步点击下一步前，必须先通过 POST `/consent` 请求 `fields: ['mentalHealthNeed']` 并完成 session 授权。搜索与最终提交也会重新检查这项权限。聊天入口会自动展示这张敏感授权卡；当前手动向导还没有该提示。前端可复用现有 ConsentCard，授权成功后继续向导。拒绝时应保留一般支持信息，不继续个性化心理健康推荐。

## 既有演示后端验证记录（前次交付）

运行 `pnpm --filter @bupa/api typecheck`、`pnpm --filter @bupa/api test` 和 `pnpm --filter @bupa/api build` 检查后端。测试涵盖契约、手动预约、授权/拒绝/撤回、会话过期、幂等、时段冲突、取消改期、敏感类别及 SSE 暂停恢复与断流。

前次交付结果：API 类型检查与构建通过，50 项自动化测试全部通过。此记录不是个性化优化本轮的验收结果；本轮重新执行的命令、结果和未通过依赖单独记录在 [后端个性化状态](backend-personalization-status.md)。

另在随机本地端口启动编译后的 Node 服务，使用真实 HTTP/SSE 完成：中文预约请求 → 两次 session 授权 → 五步确认 → 提交 → 重复提交返回原预约 → 取消。这项检查使用虚构数据，不接触真实诊所或模型。

本轮未修改前端或共享契约源码，也未执行浏览器交互验收。需要前端切换到 HTTP 模式后共同完成页面联调。提醒当前是 Dashboard 中的记录，不会发送短信、邮件或手机推送；客服转接只生成未发送的演示摘要。
