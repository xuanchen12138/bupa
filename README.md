# My Bupa Agent

Empower to Employ 2026 · Group 4D · Data Challenge。

项目已有三页面前端演示，以及可独立运行的离线 Hono 后端：Profile 与权限管理、数据回执、五步预约、取消与改期、日程、规则型 `ScriptedLLM` 和 SSE 授权暂停/恢复。所有会员、保障、诊所和预约均为虚构演示数据，不需要模型 API key。

当前新增工作是**多对话历史、Dashboard 健康概览与个性化建议**。第一阶段由前端在 `mock` 模式实现浏览器本地演示；后端同期完成契约消费检查、持久化/身份/删除设计及文档。服务端历史 API、数据库持久化和真实模型属于第二阶段，尚未上线。产品基线见根目录《My Bupa Agent 产品定义（最终版）.md》，新增范围见 [实施报告](chat-history-personalized-health-plan.md)。

## Windows 启动

需要 Node.js 24+ 与 pnpm 11.25.0。已安装依赖的本机可以直接运行 `pnpm dev`；新环境先安装依赖。

```powershell
cd C:\Project\bupa
pnpm install --frozen-lockfile
pnpm dev
```

- 前端：[http://localhost:5173](http://localhost:5173)
- 后端健康检查：[http://127.0.0.1:3001/health](http://127.0.0.1:3001/health)
- 在启动终端按 `Ctrl+C` 停止前端、后端和契约监听进程。
- 默认不需要 `.env`、数据库或 API key；`DEMO_MODE=false` 会明确拒绝启动，因为真实模型尚未接入。

若没有 pnpm，可在安装 Node.js 后运行 `npm install --global pnpm@11.25.0`。

## 两种运行模式

| 前端模式                     | 数据与执行位置                  | 当前用途                                                                          |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `VITE_API_MODE=mock`（默认） | 浏览器内 MockService 与演示剧本 | 既有预约演示，以及正在实施的第一阶段历史/个性化体验；该阶段不依赖新后端或真实模型 |
| `VITE_API_MODE=http`         | `/api/*` 经 Vite 代理至 Hono    | 既有 Profile、授权、预约、日程及对话 SSE 联调；尚无服务端对话历史和健康概览 API   |

联调已有后端时，在启动前设置模式：

```powershell
cd C:\Project\bupa
$env:VITE_API_MODE = 'http'
pnpm dev
```

也可在根目录 `.env` 中设置 `VITE_API_MODE=http`，修改后重启 Vite。恢复前端演示时改为 `mock`。同一流程应使用同一适配器，不能把本地历史与服务端预约混为同一份已持久化数据。HTTP 接口及前端待接入项见 [后端联调约定](docs/backend-integration.md)。

后端是**默认共享 Lin 的内存演示服务**。服务重启或调用重置接口会恢复 fixture；普通页面刷新不会重启后端。服务器生成的 HttpOnly `bupa_session` cookie 管理本次授权、草稿和运行请求，空闲有效期为 30 分钟，不是真实登录或长期对话身份。浏览器历史的保存、刷新恢复、删除和重置由新增前端持久化实现负责，不能据此推断服务端已经保存聊天。

## 端口冲突

开发服务器遇到占用会直接报错，不会自动更换端口。复制根目录 `.env.example` 为 `.env`，修改后重新运行 `pnpm dev`：

```dotenv
HOST=127.0.0.1
PORT=3002
WEB_PORT=5174
DEMO_MODE=true
VITE_API_MODE=mock
```

此时打开 [http://localhost:5174](http://localhost:5174)。前端代理自动跟随后端 `PORT`。已有 `.env` 时直接编辑，不要覆盖。前端仅公开 `VITE_` 前缀的环境变量，未来模型凭证只能由后端使用。

## 工程结构

```text
apps/
  web/                      React + Vite + Tailwind；前端团队维护
    src/features/           Chat、Dashboard、Profile、五步向导
    src/mock/               浏览器内业务服务和演示剧本
    src/lib/                mock / http 适配器、查询与格式化
    src/stores/             页面、聊天、向导状态
  api/                      Node + Hono；后端团队维护
    src/app.ts              REST/SSE 路由与 cookie 会话绑定
    src/agent.ts            离线 ScriptedLLM 与受限工具执行
    src/booking.ts          草稿、逐页确认、提交、取消和改期
    src/permissions.ts      授权、回执、撤回与预填失效
    src/sessions.ts         30 分钟会话与断流/关闭清理
    src/member.ts           Profile、日程、提醒、备注
    src/providers.ts        模拟保障和诊所查询
    src/safety.ts           演示危险信号阻断
    src/store.ts            单 Lin 内存数据与 fixture 初始化
    test/                   API、业务、权限、Agent、SSE 回归检查
packages/
  contracts/src/            共享 Zod schema、类型、fixtures、向导定义；前端团队维护
docs/
  architecture.md           当前架构、能力与数据边界
  backend-integration.md    既有 HTTP/SSE 联调约定
  implementation-plan.md    当前状态与分阶段开发顺序
  backend-personalization-status.md  新增后端准备工作、设计与检查记录
```

## 开发命令与检查范围

```powershell
pnpm check         # 格式、类型、现有测试、构建
pnpm typecheck     # 先生成共享契约，再检查所有包
pnpm test          # 先构建 contracts，再运行 API 测试；不运行前端交互测试
pnpm test:personalization-contracts  # 独立检查新 M0 的共享契约核心可用性
pnpm build         # 按依赖顺序构建 contracts、API、web
pnpm format        # 格式化工程文件；多人协作时优先仅格式化自己改动的文件
pnpm start         # 运行构建后的 API 和前端本地预览；先执行 pnpm build
```

`pnpm dev` 先构建 contracts，再同时监听三个包。独立运行某个包前先执行 `pnpm build:contracts`。本地预览用于验证构建产物，不是正式部署配置。

`pnpm test:personalization-contracts` 是新增 M0 的独立消费门槛，不包含在 `pnpm test` 或 `pnpm check` 中。FE 已加入对话与个性化 schema、主入口导出及手臂对话 seed，BE 已通过当前 schema 和中英文 fixture 消费检查；版本同步与 M0 最终业务约定仍待确认。缺少导出或样例不符合 schema 时该命令明确失败，不代表历史持久化、完整语义或前端交互已经完成。

根 `pnpm test` 只覆盖 API；前端历史持久化、页面交互、浏览器验收和真实模型效果必须分别记录。上述命令说明不代表本轮已执行或通过，旧文档中的测试数量也不能作为新增功能的验收结果。各阶段检查与依赖见 [实现计划](docs/implementation-plan.md) 和 [后端个性化状态](docs/backend-personalization-status.md)。

## 当前边界

AI 只能准备或更新预约字段，逐页确认和最终提交由用户完成；服务端执行权限与状态校验。保障、价格、诊所和时段都是演示数据，不承诺真实赔付或预约结果。提醒只是 Dashboard 记录，不会发送短信、邮件或推送；客服转接只准备未发送的摘要。

当前没有真实会员认证、跨会员隔离、服务端历史保存或真实模型调用。后续历史与健康记忆使用独立数据域，不能把症状直接塞进 Profile，也不能把当前 30 分钟授权 cookie 当成长期 owner 或 conversation ID。
