# My Bupa Agent 路演计划（Presentation Plan）

Sep 28, 2026 · @Sarah

## 0. 演示概览

路演只有 **3 分钟 + 3 分钟 Q&A**（团队 4D，16:30）。下面是完整的 12 页版本，第 10 节给出 3 分钟的取舍。建议把完整版做成 PPT，路演时跳过标为“可略”的页，Q&A 时再翻回去用。

**叙事主线**：我们自己就是用户 → 发现问题 → 定义四个问题 → 研究现有 App 发现“功能都在，但是分开的” → 把它们连起来 → 两个 use case → 可行性与商业价值。这正好是“发现问题 → 找到答案”的工作流程，评委在 Show Your Work 里要看的就是这个。

**贯穿全场的一句话**：Bupa already has the data and the features. What's missing is the connection: an AI that turns what Bupa knows into things it does for you.

**用户画像（全场只用这一个）**

| 项目 | 内容 |
| --- | --- |
| 名字 | Lin，24 岁，刚到墨尔本读硕士的国际学生，入学第 3 周 |
| 保险 | Bupa OSHC，签证要求购买，从没打开过 My Bupa |
| 背景 | 不了解澳洲医疗体系（GP、专科、急诊的分工）；英文日常够用，医疗和保险术语看不懂 |
| 对 AI 的态度 | 没用过，不太信任，尤其不愿意把健康信息交给机器 |
| 典型行为 | 遇到问题先问同学；不愿打英文电话；宁可拖着 |

**分工建议**：一人讲问题（第 1–3 幕，用自己的经历），一人讲方案与演示（第 4–6 幕，操作原型），一人讲价值与收尾（第 7 幕），其余人分担 Q&A。不要超过 3 个主讲人。

## 第一幕：我们怎么发现问题

这一幕的目的是建立可信度：我们不是在猜用户，我们就是用户。用第一人称讲。

### Slide 1 · Title

- 标题：**My Bupa Agent** — Your health, handled. In your language.
- 副标题：Team 4D · Challenge 4: Data
- 画面：产品三个页面的缩略图（对话、Dashboard、Profile）

### Slide 2 · We are the users

- 屏幕上：团队六人照片，下面一行："6 international students. 6 Bupa OSHC members. 0 of us had opened the app before this hackathon."（数字按真实情况填）
- 讲稿：We all bought Bupa OSHC because our visa required it. Then we never touched it. When we asked ourselves why, we found three things we had in common.
- 三个共同点（逐条出现）：
  1. We didn't know how healthcare works here. GP, specialist, emergency, telehealth: which one, when, and what does it cost?
  2. We didn't know what our cover actually included. Nobody reads a policy document in a second language.
  3. Talking to Bupa cost us more than it cost a local: calling in English about medical terms is stressful, so we just didn't.
- 收尾：The result was the same for all of us: we delayed care.

### Slide 3 · Evidence（可略，Q&A 备用）

- 团队调研：“We asked N international students…” — 填入真实数字：没用过 App 的比例、因不确定费用或语言推迟就医的比例，加 2 句访谈原话。
- 公开数据：ABS 2024-25，25–34 岁需要看牙的人中 22% 因费用推迟或没去。注明是全国数据，不是 Bupa 会员。
- 讲稿：This isn't just us. Cost uncertainty alone keeps one in five young Australians away from the dentist.

## 第二幕：从四个问题到产品目标

### Slide 4 · Four problems, one persona

- 左侧：Lin 的画像卡（名字、年龄、OSHC、入学第 3 周、“从没打开过 My Bupa”）。
- 右侧：四个 Problem Statement：
  1. **Don't know what I have** — what's covered, what I pay.
  2. **Don't know where to go** — GP vs specialist vs telehealth vs emergency.
  3. **Language barrier** — policy terms and phone calls in a second language.
  4. **Even when I know, I can't get it done** — find a clinic, compare costs, book, claim: every step is a hurdle.
- 讲稿：We turned our experience into one persona, Lin, and four problem statements. The first three are about knowing. The fourth is about doing. Most solutions stop at the first three.

### Slide 5 · What we set out to build

- 一句话：**An AI that makes talking to Bupa simpler, easier and in your own language, and then gets things done for you.**
- 三个设计原则（对应题目）：
  - Use what Bupa already knows first: policy, cover, waiting periods.
  - Ask for new information only when it unlocks something concrete.
  - Every share is visible, explained, and reversible.
- 讲稿：The challenge asks two things: get more value from existing data, and build a value exchange customers trust. Our principle is simple: Bupa gives first, asks second, and every ask buys the customer something they can see.

## 第三幕：研究现有 My Bupa，发现盲点

### Slide 6 · What My Bupa already has

- 屏幕上：现有 App 的三张截图并排：AI 聊天、找医生、预约。每张下面一句评语：
  - AI chat: answers questions, but only by tapping preset options. It shows information; it can't act on it.
  - Find a doctor / book an appointment: they exist and work, but the user has to know to look for them, and fill everything in alone.
- 中间用一个大号的“断开”符号把聊天和功能隔开。
- 讲稿：We went into the app and were surprised: almost everything Lin needs is already there. There's an AI chat. There's find-a-doctor. There's booking. The problem isn't missing features. **The problem is that they don't talk to each other.** The chat can tell you that you should see a GP. It can't book one. And the booking form doesn't know anything the chat just learned.

### Slide 7 · The blind spot

- 一句话：**Information and action live in different rooms.**
- 左：“AI that talks”（聊天）。右：“Features that do”（找医生、预约、保单、理赔）。中间：“Lin has to be the bridge.”
- 讲稿：Today, Lin is the integration layer. She reads the answer in the chat, remembers it, goes to another screen, and types it all in again, in English. That's exactly the step where she gives up. This is the same shift the industry saw in 2024–2025: AI moved from chat windows to agents that use tools. Bupa's chat hasn't made that move yet.

## 第四幕：我们的方案与创新

### Slide 8 · Our answer: connect them

- 一句话：**My Bupa Agent: the AI chat becomes the front door to everything the app can already do.**
- 三个组件，三张小图：
  - **AI Agent** — you say what you need, in any language. It checks your cover, finds a clinic, opens the booking form and fills it in. You confirm every page. It never submits for you.
  - **Profile** — one place for everything Bupa knows about you: personal details, your cover, your preferences, and a switch on every field: "may the AI use this?"
  - **Dashboard** — your calendar and reminders, plus a **health summary** built from what you've shared. Every booking the Agent makes lands here.
- 底部一行：With your permission, the Agent uses your past conversations and your health summary to make the next suggestion more personal.
- 讲稿：We didn't add a new feature. We put the AI in charge of the features that already exist, and gave the user two places to see and control what the AI knows.

### Slide 9 · How Lin learns to trust it（回答评委“怎么让用户敢分享”的问题）

- 一句话：**We don't ask Lin to trust AI. The Agent starts as a translator and earns promotions.**
- 四级阶梯（横向四格）：
  - Level 0 Translator — explains your cover in your language, remembers nothing.
  - Level 1 Form-filler — fills in forms; you press every button.
  - Level 2 Assistant — prepares bookings; you confirm once. Needs your postcode and language, with consent.
  - Level 3 Steward — watches waiting periods and follow-ups, reminds you.
- 三条规则：It only asks for a promotion right after it has done something useful. You can watch a demo before promoting it. You can demote it to Level 0 any time, and it forgets.
- 讲稿：Every level up, Lin shares a little more and gets a little more, always in that order. Data is what she hands over when she promotes it, not something we take.

这一页如果时间不够，可以压缩成 Slide 8 底部的一行，留到 Q&A 展开。

## 第五幕：Use case 1 — 第一次预约 GP（单次）

### Slide 10 · Use case 1: "I want a health check"

演示用真实原型（开启 DEMO\_MODE），幻灯片只放一张六格流程图作为备用。目标时长 60 秒。

| 步 | 屏幕上发生什么 | 一句讲稿 |
| --- | --- | --- |
| 1 | 登录后打开 **Profile**：姓名、会员号、OSHC 保单、等待期已经在，都来自 Bupa 已有数据；个性化完整度 1/5 | Lin logs in for the first time. Bupa already knows this much about her. She hasn't shared anything yet. |
| 2 | 切到 **AI Agent**，用中文输入：“我刚来墨尔本，想找个医生做个健康检查，不知道保险包不包。” | She types in Chinese. She doesn't know the word "GP". |
| 3 | Agent 用中文回复：解释健康检查在澳洲去 GP，她的 OSHC 包含 GP，自付区间，附条款出处；然后说“我可以帮你预约” | It answers from her policy, with the clause it read. Then it offers to do the booking. |
| 4 | 右侧打开 **预约向导**，第 1 页已预填：服务类型 GP、需求“健康检查”，字段旁标着“来自对话”；她点“下一步” | The form opens, already filled from what she just said. Every field shows where it came from. |
| 5 | 第 3 页“诊所”：邮编字段旁弹出**授权卡**：“需要你的邮编找附近诊所。不会用于定价或理赔。仅本次 / 始终 / 拒绝”；她选“仅本次”；三家诊所出现，带自付估算和“会说中文”标签 | **This is the value exchange.** One postcode, one clear reason, one visible result. She can say no and still continue. |
| 6 | 第 4 页“就诊人”：姓名、会员号、电话已从 Profile 填入（标签“来自 Profile”）；第 5 页汇总，她点**提交** | She checks each page and presses Submit herself. The Agent never can. |
| 7 | 切到 **Dashboard**：预约卡出现在日历上，附“要带的东西”和提前一天提醒；健康摘要新增一条“健康检查 · 已预约”；Profile 里多了一张回执 | Done. It's on her calendar, her summary is updated, and there's a receipt for the one thing she shared. |

讲完的收尾句：One sentence in Chinese, one postcode, one confirmation. Five minutes ago she didn't know what a GP was.

**演示风险控制**：提前把对话输入放在剪贴板；DEMO\_MODE 不依赖网络；录一段 60 秒屏录作为兑底。

## 第六幕：Use case 2 — 数据长期起作用（手臂受伤）

### Slide 11 · Use case 2: "Data that keeps working"

这个场景证明分享过的数据不是用一次就完，而是会继续为用户工作。目标时长 40 秒。如果原型来不及做完，用三张截图讲。

| 步 | 屏幕上发生什么 | 一句讲稿 |
| --- | --- | --- |
| 1 | 两周前：Lin 对 Agent 说“我手臂摔伤了，很疼，抬不起来”。安全检查通过（非紧急），Agent 帮她预约了 GP，流程同 use case 1 | Two weeks ago, Lin hurt her arm. Same flow: she said it, the Agent booked it. |
| 2 | 提交时多一张授权卡：“把这次就诊记入你的健康摘要，以便以后跟进？只记类别（手臂损伤），不记对话原文。”她同意 | One more question, one more receipt: may we remember that this happened? Category only, not her words. |
| 3 | Dashboard 健康摘要中出现：“手臂损伤 · GP 就诊 · 9 月 16 日” | It shows up in her health summary. Not a diagnosis, a record of what she told us and what she did. |
| 4 | 今天：Dashboard 上出现一张 **AI 建议卡**：“你两周前因手臂受伤看了 GP。这类损伤通常建议复查。要不要预约一次复诊？”底下一行小字：“因为你允许我记住了这次就诊” | Today the Agent comes back to her, and tells her exactly why it knows. |
| 5 | 她点“好”，向导打开，全部预填：同一家诊所、同一位医生、需求“手臂复查”；她只选时间、点提交 | This time she doesn't type anything. She picks a time and confirms. |
| 6 | （可选，10 秒）切到 Profile，点“撤回”那条就诊记录：健康摘要里的条目消失，建议卡消失，Agent 说“我已经不记得这次就诊了” | And if she changes her mind, the memory goes, and so does the suggestion. |

收尾句：The first time, Lin taught the Agent. The second time, the Agent looked after Lin. That's what a value exchange looks like over time.

**表述红线**：建议卡上不要写“你需要复查”这类医疗判断，只写“这类情况通常建议复查，请以医生建议为准”。评委 Sharon 如果追问“AI 是不是在做医疗建议”，答案是：它提醒的是“跟进”，不是“诊断”，且每条建议都说明依据。

## 第七幕：可行性、商业影响与未来平台

### Slide 12 · Why this is buildable now（Feasible）

- 一句话：**We didn't build anything new. We rewired what exists.**
- 三点：
  - Every tool the Agent uses is an existing My Bupa capability: policy lookup, find-a-doctor, booking, reminders.
  - Tool-calling AI is mature technology. Our agent loop is under 200 lines; the hard rules (consent before use, user presses Submit) live in ordinary code, not in the model.
  - Working prototype today: three pages, the wizard, consent and receipts, demo mode without network.
- 讲稿：The reason this is feasible is the same reason it was missing: the pieces already exist. Connecting them is engineering, not research.

### Slide 13 · What Bupa gets（Viable）

- 左列 **Today**：
  - Fewer simple support calls: cover questions and bookings handled in-app, in any language.
  - Bookings routed to Bupa's own network: dental, optical, health centres, Blua.
  - Fewer surprise out-of-pocket complaints: costs explained before the visit.
  - Structured, consented need data (language, region, need category) instead of unusable chat logs.
- 右列 **Long term**：
  - New members who use their cover in the first 90 days stay. OSHC students become domestic members after graduation.
  - Bupa has said it is moving from insurer to health partner. **The Dashboard is that platform**: today it holds bookings and a health summary; tomorrow it can carry health programs, Blua telehealth, mental-health support and follow-up care, all with the same consent model.
- 讲稿：For Bupa this isn't a chatbot upgrade. It's the front door to the health ecosystem Bupa is building, and it's a front door customers will actually walk through.

数字提醒：不要编造百分比。如果要给量级，用“如果每位新会员前 90 天少打一个电话…”这种可验证的假设句式，并标明是假设。

## 结尾与 Q&A 准备

### Slide 14 · Close

- 屏幕上只有一句话：**Bupa already knows enough to help Lin. We just let it act.**
- 讲稿：We started as six students who never opened the app. We're ending with a product we'd use tomorrow. Thank you.

### 预判的评委问题与回答

| 问题 | 回答要点 | 翻到哪页 |
| --- | --- | --- |
| 和现有 AI 聊天有什么区别？ | 现有的只显示信息；我们的能调用功能、预填表单、写入 Dashboard，并且每一步有授权和回执 | Slide 7 |
| 用户凭什么愿意分享？ | 先给后要；每次分享当场换来结果；信任阶梯从“什么都不记”开始；随时降级 | Slide 9 |
| AI 给错保障或费用怎么办？ | 只给区间和条款出处，标“需确认”；不承诺赔付；复杂情况转人工并附英文摘要 | Slide 10 第 3 步 |
| 手臂复查的建议算不算医疗建议？ | 它提醒“跟进”，不做诊断；每条建议说明依据；以医生建议为准；用户可关闭 | Slide 11 |
| 敏感信息（心理健康）怎么处理？ | 单独授权、只记类别、默认仅本次、不进营销、不进理赔审核 | Slide 9 |
| 会不会影响保费或理赔？ | 回执上写明不用于定价和理赔审核；澳洲私人医保实行 community rating，保费本来就不能按健康状况区分 | Slide 10 第 5 步 |
| 怎么衡量成功？ | 授权率、撤回率、办成率、新会员前 90 天来电量、自有服务预约量；建议在一所大学新生季试点 90 天 | Slide 13 |
| 除了留学生还能给谁用？ | 第一次自己买私人医保的年轻人、新移民家庭；所有新会员前 90 天都面对同样的问题 | Slide 4 |
| 真实系统接不接得上？ | 原型用模拟接口；工具对应 App 已有能力；需要与 Bupa 确认接口形式（诚实说这是假设） | Slide 12 |

**Q&A 规则**：每个问题固定一个人回答，不超过 30 秒；不知道就说“这是我们要向 Bupa 确认的假设”，不要现编。

## 3 分钟版本的取舍与计时表

3 分钟讲不完 14 页。路演时只用下面 9 页，其余页保留在 PPT 末尾供 Q&A 翻阅。时间按评分权重分配：问题和演示（Desirability）占一半以上。

| 时间 | 页 | 内容 | 秒数 |
| --- | --- | --- | --- |
| 0:00 | 1 | Title（一句话带过） | 5 |
| 0:05 | 2 | We are the users：三个共同点，结果是拖着不看病 | 30 |
| 0:35 | 4 | Lin + 四个问题（重点说第 4 个） | 20 |
| 0:55 | 7 | 盲点：功能都在，但是分开的（Slide 6 的截图并入这页） | 20 |
| 1:15 | 8 | 方案：Agent + Profile + Dashboard，信任阶梯用一句话带过 | 20 |
| 1:35 | 10 | Use case 1 现场演示（第 2–5、7 步，跳过 Profile 预览） | 50 |
| 2:25 | 11 | Use case 2：只讲第 3–5 步，用截图 | 20 |
| 2:45 | 12+13 | 合并成一页：“没有造新东西” + “Dashboard 是未来的健康平台” | 12 |
| 2:57 | 14 | Close 一句话 | 3 |

被压缩或移到备用的页：3（证据）、5（产品目标）、6（现有 App 截图）、9（信任阶梯全页）。评委问到“用户凭什么分享”时，直接翻到第 9 页。

**彩排要求**：完整计时至少 3 遍；演示部分单独练 5 遍，直到操作的人不看屏幕也能说词。超时时优先砍 Use case 2，不砍 Use case 1 的授权卡那一步。

## PPT 制作提示与待确认事项

**视觉原则**

- 每页一个标题句，就是上面每页的“一句话”；正文不超过 4 行。讲稿放备注，不上屏。
- Lin 的头像和名字从第 4 页开始出现在每一页角落，让评委始终跟着同一个人。
- 第 6–7 页用真实的 My Bupa 截图（注意 NDA：只在现场展示，不外传）。
- 第 8 页用产品定义文档里的页面结构图；第 10 页用端到端流程图作备用。
- 授权卡、来源标签、回执这三个界面元素在截图中用高亮框标出，它们是题目的核心。

**路演前要填入的真实数字**

- [ ] 团队六人中有几人用过 My Bupa（第 2 页）
- [ ] 同学问卷：样本数、没用过 App 的比例、推迟就医的比例（第 3 页）
- [ ] 2 句访谈原话（第 3 页）
- [ ] 向 Hack Challenge Expert 确认：现有 AI 聊天和预约功能的准确边界，避免第 6 页说错

**相对你口述的调整**（请确认）

- “Report”在文档里叫 **health summary**（健康摘要），放在 Dashboard；它记录的是“用户告诉我们了什么、做了什么”，不是医疗诊断。这样表述更安全。
- 把就诊记入健康摘要需要单独授权（Use case 2 第 2 步），而不是自动记录。这是题目的“自愿参与”约束要求的。
- 手臂复查的建议措辞改为“这类情况通常建议复查”，不说“你需要复查”。
- 信任阶梯作为第 9 页加入，因为评委已经问过“用户凭什么敢分享”；3 分钟版里只用一句话带过。
