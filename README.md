# My Bupa Agent

Empower to Employ 2026 · Group 4D · Data Challenge。

项目包含 React/Vite 前端、Hono 后端和共享 Zod 契约。第二阶段后端已接入 **OpenAI Responses API**，并实现 SQLite 历史存储、用途授权、带来源的健康概览、建议到预约草稿、删除与撤权一致性。会员、保障、诊所、费用和预约仍为**虚构业务数据**；真实模型不代表真实 Bupa 服务接入。

## Windows 启动

需要 Node.js 24+、pnpm 11.25.0。当前本机的项目根目录 .env 已配置真实模型及 HTTP 模式。密钥只由后端读取，不进入前端环境变量。

```powershell
cd C:\Project\bupa
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

- 前端：http://localhost:5173
- 后端状态：http://127.0.0.1:3001/health
- 按 Ctrl+C 停止。迁移或再次启动前先停止同一个数据库上的旧 API 进程。
- 默认 SQLite 文件为 .data/bupa.sqlite，已被 Git 忽略。启动也会自动迁移，重启保留历史和已确认的预约。
- 如端口占用，先检查已有项目服务；可设置 $env:PORT='3002'、$env:WEB_PORT='5174' 后重新运行 pnpm dev，访问终端显示的地址。
- 构建运行：pnpm build，再运行 pnpm start；修改环境后重新构建/启动前端。

## 模式与前端交接

| 配置                      | 含义                                                  |
| ------------------------- | ----------------------------------------------------- |
| VITE_API_MODE=mock        | 独立的浏览器演示，不调用本后端模型                    |
| VITE_API_MODE=http        | 前端通过 /api 代理访问后端                            |
| MODEL_MODE=scripted       | 后端离线对话；有历史时健康提取明确显示 MODEL_DISABLED |
| MODEL_MODE=openai         | 后端真实模型分类、回复与结构化事实提取                |
| DEMO_MODE=true            | 业务数据虚构；不控制是否调用模型                      |
| HISTORY_SEED=true         | 新 owner 仅首次注入虚构历史；删除后不会重播           |
| OPENAI_MODEL=gpt-4.1-mini | 当前验证过的默认模型，可配置                          |

**前端待启用项：**当前 apps/web/src/lib/api.ts 的 httpApi.features.conversations 和 personalization 仍为 false，由 Claude/前端负责改为 true 并做浏览器验收。后端相应接口已经可用。旧 /chat 能使用真实模型，但它不保存长期对话；历史能力须使用 /conversations/:id/messages。

本轮未修改前端和共享契约源码，也不会把浏览器 mock 历史自动上传。服务端个性化默认关闭，需要用户明确开启。

## 验证

```powershell
cd C:\Project\bupa
pnpm typecheck
pnpm test
pnpm test:personalization-contracts
pnpm test:runtime
pnpm build
# 以下会调用并计费真实 API，只发送代码内的虚构样例：
pnpm test:live
```

详细检查结果、接口、迁移和限制见 [后端阶段二状态](docs/backend-personalization-status.md) 与 [联调说明](docs/backend-integration.md)。产品范围见 [实施报告](chat-history-personalized-health-plan.md)。

## 数据与执行边界

开发服务默认仅绑定 127.0.0.1，使用固定 Lin 演示身份；owner 隔离已实现，但没有真实登录认证，不应直接作为公共会员服务部署。临时权限、未提交草稿、等待授权和运行任务不会在重启后恢复。

模型只能分类、回复、抽取有证据的自述。费用、保障、权限、预约冲突、逐页检查和最终提交由后端规则处理。只有用户提交才生成模拟预约；不代付、不发外部消息、不创建真实客服工单。健康概览不是诊断，软件测试不等于医学验证。
