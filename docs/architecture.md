# 工程与协作约定

阶段二后端已实现；产品与验收基线见 [实施报告](../chat-history-personalized-health-plan.md)，实际验证与限制见 [后端状态](backend-personalization-status.md)。

## 文件边界

- packages/contracts：FE 维护共享 Zod/DTO/fixture，BE 消费同一导出。
- apps/web：FE 维护 mock/http adapter、历史、Dashboard、向导和来源跳转。
- apps/api：BE 维护 Hono REST/SSE、权限/预约、SQLite、模型、来源与删除一致性。
- 根 manifest、环境示例与后端说明由 BE 维护。本轮不改变 FE 源码。

## 服务端执行

请求先解析可信 owner，再在该 owner 下解析短期 cookie session。默认入口只提供本地 Lin 虚构身份；长期历史归属不依赖 cookie 是否过期。

app.ts 适配 HTTP/SSE；repository.ts 管理 SQLite 事务、历史顺序、幂等、版本和来源关联；personalization.ts 管理用途授权、证据、派生内容和建议状态。booking/permissions/member/providers/sessions 保留确定性业务守卫。chat-execution.ts 在守卫内组合语言模型与业务工具，models.ts 仅提供结构化分类、回复和抽取。

模型得到获准的当前输入、带来源时间的受限历史及工具结果，不获得完整 Profile 或任意 HTTP 工具。模型不能确认页面、提交/取消预约、支付、修改授权或联系他人。预约提交仍是用户显式 HTTP 命令。

## 持久与临时状态

SQLite 单进程持久化 owner 业务聚合、历史消息、轮次、用途设置、概览、建议、来源边、最小提交结果和生成任务状态。单次预约/删除/撤权及相关派生变更使用同一事务。

运行中的 AbortController、consent waiter、session grant、未提交草稿留在内存。重启后轮次中断、临时授权失效，旧草稿不恢复。providers 的绝对时段随业务快照保存，重启不把已预约时段平移到新日期。

源变更先使概览失效；发布前再比较 sourceRevision、授权和来源。删除/关闭用途中断任务、清除派生数据和相关自动预填。确认预约独立保留，不作为新的症状来源。

## 接口与模式

运行时契约 0.3.0；旧 /chat 保持裸 ChatEvent，新历史流使用 ConversationStreamEvent 外壳。先落用户消息再发 turn_accepted；完成事件不代替业务提交。GET 历史不会重放副作用。

MODEL_MODE 区分 scripted/openai；DEMO_MODE=true 表示业务数据虚构。前端 mock 使用独立浏览器存储，http 通过 Vite /api 代理访问后端。当前 FE HTTP 历史/个性化能力开关待 FE 开启。

真实 API 数据处理、字符预算、错误处理和 Node SQLite 限制均见后端状态文档，不把本地测试视为生产认证、医学验证或真实 Bupa 接口验收。
