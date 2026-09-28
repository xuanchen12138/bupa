# 后端联调约定

更新：2026-09-28。后端消费共享运行时契约 0.3.0，前端与 contracts 源码由 FE 维护。真实语言模型已经接入，业务数据仍为虚构。完整验证、存储及授权边界见 [阶段二状态](backend-personalization-status.md)。

## 连接和能力开关

```powershell
cd C:\Project\bupa
pnpm db:migrate
pnpm dev
```

根 .env 的 VITE_API_MODE=http 选择 HTTP；Vite 将浏览器 /api/* 转发到 API 并移除 /api 前缀。API 默认 http://127.0.0.1:3001，前端默认 http://localhost:5173。修改环境后重启 Vite。**FE 还需将 httpApi.features.conversations / personalization 设为 true**；本轮 BE 未改这两个开关。

GET /health 保留既有 HealthResponse 字段，附加 modelMode、model、dataMode、storage、features。mode=demo/dataMode=fictional 描述业务数据；modelMode=openai 表示实际模型配置，不能混为一谈。

服务端固定 demo-lin 是本地演示身份，cookie 不是登录。生产需要注入可信 resolveOwner，不接受客户端自报 owner/memberId。JSON 正文上限 64 KiB，跨站写请求拒绝，返回 Cache-Control: no-store。

## 新接口

下表为 API 路径，浏览器加 /api 前缀。成功直接返回对象，不包 data；请求/响应使用 packages/contracts 的 schema。

| 方法与路径                                   | 请求                                    | 响应                               |
| -------------------------------------------- | --------------------------------------- | ---------------------------------- |
| GET /conversations                           | query: limit?, cursor?                  | ConversationListResponse           |
| POST /conversations                          | { requestId }                           | Conversation，201                  |
| GET /conversations/:id                       | 无                                      | Conversation                       |
| GET /conversations/:id/messages              | query: limit?, cursor?                  | ConversationMessagesResponse       |
| GET /conversations/:id/messages/:messageId   | 无                                      | ConversationEntry                  |
| DELETE /conversations/:id                    | 无                                      | DeleteConversationResponse         |
| POST /conversations/:id/messages             | ConversationTurnRequest                 | ConversationStreamEvent SSE        |
| POST /conversations/:id/turns/:turnId/cancel | 无                                      | CancelTurnResponse                 |
| GET /personalization                         | 无                                      | PersonalizationSettings            |
| PATCH /personalization                       | { enabled }                             | PersonalizationSettings            |
| GET /health-overview                         | 无                                      | HealthOverviewResponse             |
| POST /health-overview/refresh                | 无                                      | HealthOverviewRefreshResponse，202 |
| POST /health-suggestions/:id/dismiss         | { expectedSnapshotRevision }            | HealthOverviewResponse             |
| POST /health-suggestions/:id/start           | { requestId, expectedSnapshotRevision } | StartSuggestionResponse            |

分页默认 30，上限 100。列表按 updatedAt、id 倒序；消息按 order 升序。游标绑定 owner 与资源，只含排序边界，不包含健康文本。新消息进入前面的页面时，继续旧游标不会重复已读记录；需要刷新列表获取最新排序。空对话不出现在列表，GET 不改变排序。

同 requestId 重复创建返回原对话；已删除创建键返回 SOURCE_REMOVED，不复活。相同 clientMessageId/相同正文的完成轮次读取持久结果；运行中 CHAT_BUSY；中断/失败返回 TURN_INTERRUPTED，由用户明确重试并提供新 clientMessageId。相同键不同正文返回 IDEMPOTENCY_CONFLICT。

建议 start 只建立/恢复后续对话。客户端按返回的 initialMessage[locale]、clientMessageId、originSuggestionId 向该对话发消息；不得自行复制/伪造伤情作为新 user_input。请求版本过期返回 STALE_SUGGESTION。建议的手工用户回复依旧是普通 user_input。

## 历史流和恢复

每个 SSE 帧使用 LF 与空行分隔、event 为 payload.type，data 为：

```json
{
  "conversationId": "conversation-...",
  "turnId": "turn-...",
  "eventIndex": 0,
  "at": "2030-06-03T00:00:00.000Z",
  "entryId": "message-...",
  "payload": {
    "type": "turn_accepted",
    "userMessageId": "message-...",
    "clientMessageId": "client-..."
  }
}
```

用户消息先提交数据库再发 turn_accepted。工具状态复用 entryId/order，eventIndex 每次递增；正文、工具和授权记录先保存再发送。结束发 done 并关闭流。已经完成的重试只返回已保存的结果，不执行工具副作用。

15 秒保活，consent 最多等待 120 秒。授权仍是另一个 POST /consent/:id，原流继续；切换/取消用 cancel 路由或断流，释放控制器与等待者。中断后 GET 消息读取 completed/interrupted/failed 状态，不承诺 token 级重连。重启不会恢复 pending 授权按钮的操作能力。

旧 POST /chat 保留裸 ChatEventSchema；sessionId 只为兼容前端，不是访问凭据。旧路由不保存长期对话，请启用新路由实现历史与上下文。

## 既有业务接口

| 方法与路径                                | 行为                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| GET/PATCH /profile                        | 读取或修改 Profile                                         |
| PATCH /profile/permissions                | { field, permission: off/session/always }，返回 Profile    |
| GET /receipts；DELETE /receipts/:id       | 回执列表；撤回返回 Receipt[]，撤回用途回执同时关闭个性化   |
| GET /schedule                             | Schedule                                                   |
| POST /bookings/:id/cancel                 | 幂等取消，返回 Schedule                                    |
| GET/POST /reminders；PATCH /reminders/:id | 读取列表、创建记录、开关；写入返回 Schedule                |
| GET/POST /notes                           | 读取列表、创建备注；写入返回 Schedule                      |
| POST /cards/:id/dismiss                   | 返回 Schedule                                              |
| GET /providers/:id                        | Provider 或 null                                           |
| POST /providers/search                    | ProviderSearch → ProviderSearchResult；复用资料须有权限    |
| POST /wizards/booking                     | { prefill?, rescheduleOf?, conversationId? } → WizardDraft |
| GET/PATCH/DELETE /wizards/:id             | 读取、按 WizardPatch 更新、放弃                            |
| POST /wizards/:id/submit                  | { booking, receipt, conversationId? }，重复返回原结果      |
| POST /consent                             | { fields, sensitive?, wizardFieldId? } → ConsentRequest    |
| POST /consent/:id                         | { decision: session/always/deny } → { request }            |
| POST /session/close                       | 关闭临时会话，204                                          |
| POST /demo/reset                          | 重置该演示 owner 并按配置重新播种，204                     |

手工独立草稿 conversationId 可空；绑定后另一个对话不能用 openDraftId 访问。改期默认沿用原预约关联，原预约只在新预约通过全部验证后取消。所有提交仍需完整五步确认及服务端时段冲突检查。重启后的未提交草稿 404，已确认预约/必要回执持久存在。

字段值的 source/confirmed 等元数据由服务器生成，客户端不能伪造。location/language 等字段授权只用于相应工具，完整 Profile 不发送模型。敏感需求另走 session 许可。虚构业务标识持续保留。

## 个性化、删除和失败

个性化默认关闭。开启会创建用途回执并触发 pending；查看 Dashboard 可有限轮询，再提供手动刷新。status 可为 disabled/empty/pending/ready/error。generationMode=model 表示真实模型产物，dataMode=fictional 表示数据身份。scripted 模式有来源而无模型时显示 MODEL_DISABLED，不伪造提取。

新自述/删除/授权变化递增 sourceRevision，立即清空旧概览；原任务提交时必须匹配当前版本。建议状态变更递增 snapshotRevision；概览与建议一起发布。

删除可重复调用；删除当前流阻止迟到写入。来源相关的派生聊天和未提交预填同步失效。关闭用途保留原始历史，清除跨对话派生内容；重新开启只依据当前仍存在的来源。用户确认的预约独立保留，不因删聊天而取消，也不变成替代健康证据。

REST 错误是 { error: { code, message, retryable } }，常见为 CONVERSATION_NOT_FOUND、SOURCE_REMOVED、CHAT_BUSY、TURN_INTERRUPTED、STALE_SUGGESTION、PERSONALIZATION_DISABLED、CONTEXT_LIMIT。流内保留契约规定的 error.message，模型错误为脱敏错误码；概览 error 含 code/message。失败时历史和手动预约继续可用。

模型 API 请求 store=false，但不能据此宣称供应方零保留。临时处理许可与聊天保存是不同用途；用户可以删除保存的对话。本地删除无法撤回供应方已经收到的输入。详见后端状态文档。
