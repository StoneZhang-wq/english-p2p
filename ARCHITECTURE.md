# 英语口语真人匹配平台 — 项目架构与开发规范

本文档与 `docs/产品描述.md` 共同作为实现依据；**产品规则以产品描述为准**，**工程结构、接口与库表以本文为准**。若冲突，先对齐文档再改代码。

---

## 1. 项目概述

- **形态**：移动端网页优先（手机浏览器），用户通过**预约主题 + 时间段 + 口语水平**参与**角色扮演式**英语对话。
- **核心流程**：登录 → 浏览主题/场次 → **预约（受截止规则限制）** → **预约后即可进等待大厅（RTC）** → **开场到点后首轮自动配对 + 通知** → **个人中心/接口展示具体搭档（昵称、水平）** → **停配扫描 / 开场落单互配（若需要）** → Agora 实时语音（配对后切 1v1 频道） → 结束并更新信用分。
- **地域**：现阶段大陆用户（时区 `Asia/Shanghai`）。

---

## 2. 技术栈（强制）

| 层级 | 选型 |
|------|------|
| 前端 | HTML5 + CSS3 + **原生 JavaScript**（可选后续引入 Vue 3 CDN），响应式 flex/grid，**主视口宽度 &lt; 600px** 优先 |
| 后端 | **Node.js + Express** |
| 数据库 | **PostgreSQL**（`pg` + `DATABASE_URL`）；`db/schema.postgres.sql` 建表 |
| 实时语音 | **Agora RTC Web SDK v4.x** |
| 通知 | **Nodemailer**（邮件）；后续可选阿里云/腾讯云短信 |
| 部署 | 轻量云服务器 + **Nginx** 反向代理 + **PM2** 守护 |

---

## 3. 目录结构（目标与现状）

**当前仓库**：前端静态页位于 `backend/public/`（`index.html`、`booking.html`、`appointments.html`、`room.html` 等），由 Express 同机托管。

**目标布局**：

```text
project-root/
├── backend/
│   ├── routes/           # API 路由
│   ├── controllers/      # 业务逻辑
│   ├── models/           # 数据访问（PostgreSQL / pg）
│   ├── services/         # 邮件、短信、Agora Token、**预习 docx 生成**（`buildPreviewMaterialDocx.js`）等
│   ├── data/             # 静态配置（如 `themeRotationPool.js` 周主题轮换池）
│   ├── utils/            # 验证码、配对算法、**周末场次规则**（`weekendSlotRules.js`）、**周主题周期**（`weekThemeCycle.js`）等
│   ├── cron/             # 定时任务（配对、停配扫描、开场互配等）
│   ├── public/           # 前端静态页（HTML/CSS/JS，express.static）；含 `dev-lab.html`（沙箱验收入口）
│   └── app.js            # Express 入口
├── db/
│   └── schema.postgres.sql # 建表脚本（见第 4 节）
├── docs/
│   ├── 产品描述.md
│   ├── 产品与需求变更规则.md
│   ├── 用户体验框架.md
│   └── 产品功能与体验规格-AI前端用.md
├── .cursor/
│   └── rules/
├── db/schema.postgres.sql # PostgreSQL 建表（与 backend/schema.postgres.sql 同步）
├── .env                  # 环境变量（不提交）
├── .cursorrules          # Cursor 入口规则
├── ARCHITECTURE.md       # 本文件
└── README.md
```

---

## 4. 数据库设计

执行 `db/schema.postgres.sql`（或应用启动时自动执行）初始化。核心表如下（与实现保持一致时可扩展字段，但需同步改本文与迁移脚本）。

```sql
-- 用户表（邮箱 + bcrypt 密码哈希；认证 API 见 README）
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(120) UNIQUE,
  nickname VARCHAR(50) NOT NULL,
  password_hash TEXT,
  credit_score INTEGER NOT NULL DEFAULT 10,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  difficulty_level VARCHAR(20) DEFAULT 'intermediate',
  task_card_a TEXT,
  task_card_b TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE timeslots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id INTEGER NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  max_pairs INTEGER NOT NULL DEFAULT 5,
  booked_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  FOREIGN KEY (theme_id) REFERENCES themes(id)
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  timeslot_id INTEGER NOT NULL,
  level VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
  UNIQUE(user_id, timeslot_id)
);

CREATE TABLE pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timeslot_id INTEGER NOT NULL,
  user_a INTEGER NOT NULL,
  user_b INTEGER NOT NULL,
  channel_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (timeslot_id) REFERENCES timeslots(id),
  FOREIGN KEY (user_a) REFERENCES users(id),
  FOREIGN KEY (user_b) REFERENCES users(id)
);

CREATE TABLE credit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  change INTEGER NOT NULL,
  reason VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**说明**：`phone` / `email` 至少一种用于登录时，应用层校验；库表允许扩展 `NOT NULL` 策略。

---

## 5. API 规范（REST + JSON）

### 5.1 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

- **code**：`0` 成功；`400` 参数错误；`401` 未登录；`403` 无权限；`409` 业务冲突（如超售、截止预约）；`500` 服务器错误。

### 5.2 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/send-code` | 发送验证码（手机号或邮箱） |
| POST | `/api/login` | 验证码登录，返回会话 Token |
| GET | `/api/themes` | 当前开放周期内**三个**周主题（`weekThemeCycle.js` 的 `getActiveThemeWeekMondayNow`）；未到首次开放点则 `themes` 为空并带说明；**周日 19:00～21:00（上海）**若与「本周」周期尾重叠，取**周一 YMD 最大**的候选周（见第 6.6 节） |
| GET | `/api/themes/by-id` | Query：`id`=`theme_id`；预约页拉取展示字段（含 `preview_markdown`、已归档亦可读） |
| GET | `/api/timeslots` | Query：**`theme_id`（必填）**；仅返回 **北京时间周六、日 20:00 开场** 的 `open` 场次（`weekendSlotRules.js` 过滤）。库内 `timestamp without time zone`；`to_char` 读出字符串再过滤，避免 UTC 下 `Date` 误判 |
| GET | `/api/preview-material/docx` | Query：`theme_id`；**须登录**；正文来自 `themes.preview_markdown`，`docx` 包生成 |
| POST | `/api/book` | Body：`timeslot_id`, `level`；**受预约截止与容量约束** |
| GET | `/api/my-bookings` | 当前用户预约列表；**若已配对**，每条含 **搭档昵称 `partner_nickname`、搭档水平 `partner_level`**（不对用户暴露对方手机号） |
| DELETE | `/api/cancel-booking/:id` | 取消预约（`services/cancelBooking.js`）：须登录且预约归属当前用户；**场次开始时间（上海 naive）到达前**可取消；事务内 **DELETE** `bookings` 行（避免 `(user_id, timeslot_id)` 唯一约束阻碍再次预约）、`timeslots.booked_count - 1`、删除该用户在本场次上的 `pairs` 行 |
| GET | `/api/my-pair` | Query：`timeslot_id`；返回 **channel_name、agora_app_id、agora_token（可选）、搭档昵称、搭档水平、双方任务卡/角色** |
| POST | `/api/end-conversation` | Body：`pair_id`, `duration_seconds` 等；用于结算与信用分 |
| GET | `/api/user/profile` | 昵称、信用分等 |
| POST | `/api/agora/rtc-token` | Body：`{ channelName, uid }`；返回 `appId`、`channelName`、`token`、`uid`、`expiresIn`。**须开启声网 App Certificate**；**演示/联调用**，不校验预约（与 `rtc-token-booking` 区分） |
| POST | `/api/agora/rtc-token-booking` | **须登录**。Body：`{ timeslot_id }`；校验当前用户在该场次有 `confirmed` 预约；若已存在包含本人的 `pairs` 则返回该 **1v1** `channel_name`，否则返回**同场等待大厅**频道名 `engw{timeslotId}`（`utils/agoraChannelNames.js`）；`uid` 取用户 id（须满足声网 uint32）；响应另含 **`startTime` / `endTime`**（`to_char` 上海 naive 字符串）与 **`rtcMode`**：`waiting` \| `paired`，供房间页开场文案与「匹配提示」按钮 |

**管理员后台（最小可用）**：通过环境变量 `ADMIN_EMAILS`（逗号分隔 email 白名单）启用管理员身份；静态页 `public/admin.html`；接口统一前缀 `/api/admin/*`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/timeslots` | Query：可选 `theme_id`；返回场次列表（含预约数、pairs 数） |
| GET | `/api/admin/timeslots/:id/bookings` | 返回该场次 `confirmed` 预约用户（含 email/nickname/level） |
| GET | `/api/admin/timeslots/:id/pairs` | 返回该场次 pairs 列表 |
| POST | `/api/admin/timeslots/:id/pair` | Body：`{ user_a, user_b, force? }`；两人须均已预约该场次；`force=true` 时会先清掉该场次中涉及任一人的旧 pairs；随后插入一条新 pairs（频道名 `admin_eng_...`） |
| POST | `/api/admin/timeslots/:id/unpair` | Body：`{ pair_id }`；删除该场次指定 pairs |

**开发调试（非正式配对）**：当 `NODE_ENV !== 'production'` **或** `ENABLE_DEV_PAIRING=1` 时挂载 `routes/devPairing.js`（否则不注册该路径）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/dev/pair-timeslot` | Body：`{ timeslot_id }`（整数）。**须登录**；调用者须在该场次有 `confirmed` 预约，且存在另一名同场次预约者与其**口语等级差≤1**（`utils/levelCompatibility.js`）；事务内 **删除该场次全部 `pairs`** 后 **INSERT** 一行（`channel_name` 形如 `dev_eng_{timeslotId}_{ts}`，满足声网频道字符集）。**禁止**在生产长期开启 `ENABLE_DEV_PAIRING`；用于**早于开场**强制造 `pairs` 的调试，与正常「开场后 `runAutoPairingScan`」不同。 |
| POST | `/api/dev/theme-llm-rerun` | Body：`{ theme_id }`（整数）。**须登录**；清空该主题 `llm_generated_at` / `room_tasks_json` / `llm_prompt_version` 并**立即**调用 LLM 写回（**消耗额度**）。仅**非沙箱**且 `shanghai_week_monday` 非空之主题；与 `pair-timeslot` 同开关（`NODE_ENV` 非 production 或 `ENABLE_DEV_PAIRING=1`）。 |

**沙箱实验室（见第 6.7 节）**：**已实现** — `GET /api/dev/sandbox-lab`、`POST /api/dev/sandbox-slot/refresh`（须登录；仅非生产或 `ENABLE_SANDBOX_LAB=1`）；`public/dev-lab.html`；`themes.is_sandbox`、`services/sandboxLab.js`、`initDb` 内 `ensureSandboxLab`。

### 5.3 预约截止（强制）

- **规则**：当场次 `start_time` 与服务器当前时间（`Asia/Shanghai`）相差 **小于 60 分钟** 时，**禁止新建预约**该场次（**沙箱主题 `is_sandbox` 除外**，见第 6.7 节）。
- **实现**：`POST /api/bookings` 在调用 `bookTransaction` 前对**非沙箱**场次做上述校验；`GET /api/timeslots` 仍返回场次列表，前端 `booking-flow.js` 对非沙箱场次在距开场不足 60 分钟时禁用卡片。
- **已存在**的 `confirmed` 预约**不因截止而自动取消**（除非产品另定）。

### 5.4 配对结果与「具体对象是谁」

- 配对策略以 `docs/产品描述.md` **第 5.3、9 节**为准：**开场到点后首轮自动配对**、**取消触发的重配**、**开场前 60 分钟停新约**、**停配时刻全员可配性检查**、**开场落单互配**（后三项在代码中部分仍为待办）。
- 每次 `pairs` 写入或变更后：
  - **通知**（邮件/短信/Push）须覆盖产品第 10 节所列关键事件（首次成对、重配、场次取消、新搭档分配等）。
  - **个人中心 / 预约详情**与 **`GET /api/bookings/mine`**（及未来的 **`GET /api/my-pair`**）必须在数据层带出**当前用户对应的那一位搭档**的 `nickname` + `level`（实现上通过 `user_a`/`user_b` 与当前用户 id 判断对方用户行）；**频道名**仅服务端生成。
- **禁止**在接口或前端对其他用户展示**手机号、邮箱**等敏感字段。

---

## 6. 关键业务逻辑（必须遵守）

### 6.1 预约容量

- 使用**数据库事务**；更新 `timeslots.booked_count` 前用 **`SELECT ... FOR UPDATE`**（或等价行锁）锁定场次行。
- 条件：`booked_count < max_pairs * 2` 方可新增一条 `confirmed` 预约。

### 6.2 配对算法（开场首轮 + 停配 + 开场）

- **输入**：同一 `timeslot_id`（及同一主题）下 `status='confirmed'` 的 `bookings`（含 `level`）；以及开场签到窗口内识别出的**落单池**用户集合（用于二次配对，**待实现**）。
- **输出**：创建/更新/解除 `pairs` 行；`channel_name` 建议格式：`engp{timeslot_id}_{timestamp}`（仅服务端生成；**重配时须换新频道标识**以免串线）。
- **约束**（与 `docs/产品描述.md` 第 9 节一致）：两人等级差 **≤ 1**；**优化目标**：最大化成对人数、最小化落单人数。当前 MVP 为**贪心**逐对写入（`services/autoPairingAtSlot.js`），非全局最优图匹配。
- **触发时机**（当前仓库）：
  1. **开场到点后**：`app.js` 每 **60 秒**调用 `runAutoPairingScan`：对「`now ∈ [start_time, end_time)`（上海 naive 解析）」且 `open` 的场次，在事务内对**尚未出现在任何 `pairs` 行中**的预约用户做贪心相容配对并 `INSERT pairs`。**不在** `POST /api/bookings` 成功路径上立即配对。
  2. **停配时刻**（`start_time - 60min`）：全员可配性扫描与兜底（第 7 节）**仍待实现**。
  3. **开场到点落单互配**：**仍待实现**（依赖签到/上线判定）。
- **兜底**：停配扫描仍无法全员合法成对时，按产品描述执行**场次取消 + 全员通知 + 信用补偿 + 优先预约权**，且不扣用户分。
- **「已上线」判定**（须文档化并在接口中体现）：例如进房页心跳、`joinChannel` 成功回调、或显式签到 API；具体字段在实现阶段补充至本文与 OpenAPI/README。

### 6.3 信用分（与产品描述一致）

- 初始 10；正常完成（双方确认且 **≥ 10 分钟**）**+1**；爽约 **-2**；早退（未满 10 分钟且无双方同意）**-1**；守约方因对方问题 **+1**；**≤ 3 分禁止预约**需管理员恢复。
- 所有变动写入 `credit_logs`。

### 6.4 房间与 Agora

- **Web SDK**：使用 **4.x**（如 `agora-rtc-sdk-ng@4.23.x` CDN：`AgoraRTC_N-production.js`）。
- **Token**：**必须**启用控制台 **App Certificate**。正式预约进房使用 `POST /api/agora/rtc-token-booking`（`timeslot_id`）；演示联调仍可用 `POST /api/agora/rtc-token`（`channelName` + `uid`）。流程：`createClient` → `join` → `createMicrophoneAudioTrack` → `publish`；可调用 `enableLogUpload` 便于排障。
- 前端仅使用接口返回的 `channelName` / token / appId；**禁止**前端自拟频道名（`room.html?timeslot_id=` 为预约路径；`?channel=&uid=` 为演示路径）。
- iOS 非 Safari 麦克风限制：房间页**顶部红色提示**建议使用 Safari 或 Chrome。
- **房间内信令（WebSocket）**：`GET /ws/room?channel=…&uid=…`（`services/roomTaskWs.js` 在 HTTP `upgrade` 上接入）。与产品一致的消息包括：`task_complete_request` / `task_confirm_prompt` / `task_confirm_response` / `task_confirm_result`（CLAIM 确认流）；**角色互换**：客户端发送 `role_swap_intent`（JSON字段 `wants: boolean`），服务端向**同频道其他 uid** 转发 `role_swap_peer_intent`（含 `fromUid`、`wants`）。两端均在本地维护「己方 / 对方是否请求互换」，**仅当双方同时为 true** 时执行界面角色交换并再发 `wants: false` 复位；实现见 `public/js/room-tasks.js`（`__roomSendRoleSwapIntent`）、`public/js/room-role-swap.js`。
- **预约进房与 WS的 channel/uid**：`room.html?timeslot_id=` 的 URL **不含** `channel`/`uid`；`room-agora.js` 在每次 `rtc-token-booking`（及轮询切频道）成功后调用 `window.__roomWsSetChannelUid(channelName, uid)`，`room-tasks.js` 据此重连 WebSocket，与 Agora 所在频道一致。

### 6.5 定时任务（Cron）与事件

- **开场首轮配对**：已实现 **每 60 秒** `runAutoPairingScan`（见 6.2），仅对**已开始且未结束**的场次写入 `pairs`。
- **停配扫描**：对 **`start_time - 60min`** 已过的场次做全员可配性检查与第 7 节兜底 — **仍待实现**。
- **开场落单互配**：在 `start_time`（或签到截止）到达时触发任务，读取签到状态，更新 `pairs` 并发送通知 — **仍待实现**。
- **事件驱动（可选增强）**：`DELETE /api/cancel-booking/:id` 后可在同场次立即尝试重配；当前主要依赖下一轮分钟扫描。
- 时区：**Asia/Shanghai**。

### 6.6 周主题的「当前开放周」（`weekThemeCycle.js`）

- **`getActiveThemeWeekMondayNow()`**：在所有满足「已过该周 `bookingOpensAt`」且「当前时刻早于该周 `weekCycleEndsAt`」的上海周一起算的自然周中，返回 **周一 `YYYY-MM-DD` 最大**的一周。避免周日 19:00 起下一周已开放、但本周周期尚未到周日 21:00 结束时，仍把「本周」当作活跃周而导致首页与预约仅展示**已截止**的本周场次。
- **`getWeekMondaysToEnsure()`**：可返回**多个**周（含重叠窗口内的两周），供启动/定时任务补全 `themes` 与 `timeslots`。

### 6.7 沙箱实验室（已实现，与 `docs/产品描述.md` 第 5.6 节一致）

**目标**：专用主题 `slug=sandbox-lab` + 单场次，支持「约 3 分钟后开场」的滚动时间、**豁免**距开场 60 分钟停新约；两名测试账号预约后可用 **`POST /api/dev/pair-timeslot`** 或开场窗口内 `runAutoPairingScan` 写入 `pairs` 后进房。

| 项 | 实现 |
|----|------|
| 数据标记 | `themes.is_sandbox BOOLEAN`（迁移 `migrateThemesSandboxFlag`）；`ensureSandboxLab` 在 `initDb` 末尾创建主题与首条 `timeslots`（若缺） |
| 场次刷新 | **`POST /api/dev/sandbox-slot/refresh`**（须登录；`app.js` 中 `ENABLE_SANDBOX_LAB=1` 或非 production）：事务内删该场次 `pairs`/`bookings`，将 `start_time`/`end_time` 设为上海 `now+3min`～`now+63min` |
| 状态查询 | **`GET /api/dev/sandbox-lab`**：返回 `themeId`、`timeslotId`、`startTime`、`endTime`、预约/房间路径提示 |
| 预约截止 | `POST /api/bookings` 对**非**沙箱场次校验距开场不足 60 分钟则 409；沙箱跳过。`booking-flow.js` 对沙箱主题不显「已截止」 |
| 场次列表 | `GET /api/timeslots`：若主题为沙箱则**不过滤**周末 20:00；响应 `theme.isSandbox` |
| 房间 RTC | `rtc-token-booking` 响应 **`isSandbox`**；`room-agora.js` 对沙箱 **waiting** 直接 join 等待大厅，不延迟到 `startTime` |
| 入口 | **`public/dev-lab.html`**；首页底部链到沙箱页 |

### 6.8 LLM 内容生成（OpenAI 兼容接口，与 `docs/产品描述.md` 第 8.3 节一致）

**目标**：主题名、描述、场景、角色、预习 Markdown、封面 URL、**房间内 3 条任务 + 英文 hints** 由服务端调用 **OpenAI Chat Completions 兼容** API（豆包方舟等）生成后**落库**；前端通过 `GET /api/themes/by-id` 与 **`POST /api/agora/rtc-token-booking`** 的 `roomTasks` 字段读取。

**已实现**：

| 项 | 实现 |
|----|------|
| 凭据与端点 | 环境变量 **`OPENAI_API_KEY`**、**`OPENAI_BASE_URL`**（可填完整 `.../chat/completions` 或只填 `https://ark.../api/v3`）、**`OPENAI_MODEL`**（方舟常为 `ep-xxxx`）；可选 **`MODEL_PROVIDER`**（日志用，如 `doubao`） |
| 服务模块 | `services/llmChat.js`（HTTP `fetch`）、`services/themeLlmEnrichment.js`（提示词、JSON 校验、`tryEnrichThemesWithLlm`） |
| 存储 | `themes.room_tasks_json`（JSONB）、`themes.llm_generated_at`、`themes.llm_prompt_version`；其余覆盖 `name`、`description`、`scene_text`、`roles_json`、`preview_markdown`、`cover_url`、`difficulty_level` |
| 触发 | **`initDb` 结束后**尝试一轮；**`runWeeklyThemeMaintenance`（每 10 分钟）**后再尝试；每次最多 **3** 条 `llm_generated_at IS NULL` 且**非沙箱**的周主题 |
| 房间展示 | `room-agora.js` 首次 `rtc-token-booking` 成功后调用 `window.__applyRoomTasksFromApi(roomTasks)`；无 `room_tasks_json` 时保留 `room.html` 默认静态任务 |
| 未配置 Key | `tryEnrichThemesWithLlm` 直接跳过；种子数据仍来自 `themeRotationPool` |

---

## 7. 前端规范

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`（与现有 `backend/public/` 页一致）。
- 主要可点区域 **≥ 44×44px**。
- 视觉基线：主题蓝可用 `#4A90E2` 或现有 `public/` 样式中 `#1A5CFF` / `#7096FF`，**同一应用内统一**；卡片圆角约 **12px**。
- 加载：使用 spinner 或骨架屏；错误用 **toast**，避免原生 `alert` 作为主交互。

---

## 8. 环境变量（示例）

```env
PORT=3000
DB_PATH=./db/app.db
TZ=Asia/Shanghai
EMAIL_HOST=smtp.qq.com
EMAIL_USER=
EMAIL_PASS=
AGORA_APP_ID=
AGORA_CERTIFICATE=
SMS_ACCESS_KEY_ID=
SMS_ACCESS_SECRET=
# 以下为规划能力（未实现时留空即可）
ENABLE_DEV_PAIRING=0
ENABLE_SANDBOX_LAB=0
# LLM（OpenAI 兼容：豆包方舟等）。未配置或占位 Key 时不调用，主题仍为轮换池静态种子。
MODEL_PROVIDER=doubao
OPENAI_API_KEY=
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
OPENAI_MODEL=
DOUBAO_API_KEY=
# DOUBAO_ENDPOINT=   # 若与默认火山方舟网关不同再填
```

### 8.1 线上（`NODE_ENV=production`）验收沙箱时的环境变量

在 **Railway 等生产环境** 默认**不会**挂载 `/api/dev/sandbox-*` 与 `/api/dev/pair-timeslot`（因 `NODE_ENV` 为 `production`）。若要在**线上**使用沙箱页与接口，须在部署平台**显式**设置：

| 变量 | 是否必填（线上测沙箱） | 说明 |
|------|------------------------|------|
| **`ENABLE_SANDBOX_LAB=1`** | **必填** | 否则 `GET /api/dev/sandbox-lab`、`POST /api/dev/sandbox-slot/refresh` 不注册，`dev-lab.html` 会报网络/404 类错误。 |
| **`ENABLE_DEV_PAIRING=1`** | **可选** | 仅在需要在**场次尚未进入「已开始」窗口」**时，用 `POST /api/dev/pair-timeslot` **手动**写入 `pairs` 时打开；若只等 `runAutoPairingScan` 自动配对，可不设。生产长期开启有滥用风险，验收后应改回 `0` 或删除。 |

另须将浏览器访问的 **Origin**（如 `https://xxx.up.railway.app`）加入 **`CORS_ORIGINS`**（逗号分隔），且 Cookie 登录与同源/跨域策略一致。

---

## 9. 脚本约定（待 package.json）

- `npm run dev`：`nodemon` 启动 `backend/app.js`
- 应用启动：执行 `schema.postgres.sql`（`CREATE IF NOT EXISTS`）；**周主题相关唯一索引**不在该 SQL 中建（旧库已有 `themes` 表时会在 `ALTER` 列之前失败），改由 `migrateWeeklyThemesColumns` 在 `ALTER` 之后创建。随后将无 `shanghai_week_monday` 的旧主题置为下架，再 **归档过期周** 并 **`ensureWeeklyThemeCycle`**。进程内每 **10 分钟** 调用 `runWeeklyThemeMaintenance()`。
- 生产：`pm2 start backend/app.js --name english-match`

---

## 10. 代码风格

- 后端：ESM 或 CJS 统一即可；**async/await**；`try/catch` 集中错误处理；配对等复杂逻辑**必须注释**思路。
- 前端：模块化（可拆 `js/*.js`）；HTTP 统一 **`fetch`**；避免污染全局。
- **产品/业务变更**：先改 `docs/产品描述.md`，再在 `docs/产品与需求变更规则.md`「变更记录」追加一行。

---

## 11. 实现状态与代码对照（截至文档更新日）

本节与 `docs/产品描述.md` 第 13 节表格一致，并补充工程侧细节；排期以本节为准。

| 项 | 说明 |
|----|------|
| 认证 | `POST /api/auth/register`、`POST /api/auth/login`：邮箱 + bcrypt + JWT Cookie；`middleware/requireAuth.js` 解析后注入 `req.user.id` |
| 数据隔离 | `bookings` 查询已带 `WHERE b.user_id = $1`；新增接口须沿用「从会话取 user_id，禁止信任客户端传来的 owner id」 |
| 预约 | `POST /api/bookings` + `services/bookTransaction.js`：事务 + `FOR UPDATE` 防超卖 |
| 预约截止 60 分钟 | **未做**：`bookTransaction` / `timeslots` 路由未按 `Asia/Shanghai` 与 `start_time` 拦截 |
| 配对（开场首轮 / 取消重配 / 停配 / 开场互配） | **部分**：`runAutoPairingScan` 开场窗口内贪心写 `pairs`；**通知、停配扫描、落单互配**仍待实现 |
| 我的预约 | `GET /api/bookings/mine`：含 `LEFT JOIN pairs` 展示搭档昵称等（若库中已有配对行） |
| Agora | `POST /api/agora/rtc-token-booking`：需登录 + 预约校验；`POST /api/agora/rtc-token` 仍为演示；生产可收紧 rtc-token |
| 房间页 | `public/room.html`、`js/room-agora.js`（`timeslot_id` 轮询切频道）、`js/room-practice-tasks.js`（TASKS 列表、常用句折叠、演示刷新/模拟）、`js/room-tasks.js`（CLAIM + `role_swap_intent` 信令）、`js/room-role-swap.js`（角色与双方确认互换 UI）、`services/roomTaskWs.js` |
| 信用分结算 | `credit_logs` 表已建；**无** `POST /api/end-conversation` 等与产品一致的结算链路 |
| 沙箱实验室 | 产品第 5.6 节、本文第 6.7 节 | **已有**：`is_sandbox`、`sandboxLab.js`、`dev-lab.html`、`GET/POST /api/dev/sandbox-*`、预约/场次/进房例外 |
| LLM（OpenAI 兼容：豆包方舟等）写主题/预习/房间任务 | 产品第 8.3 节、本文第 6.8 节 | **已实现**：`services/llmChat.js`、`services/themeLlmEnrichment.js`；`OPENAI_*` / `MODEL_PROVIDER`；`themes.room_tasks_json`、`llm_generated_at`、`llm_prompt_version`；`rtc-token-booking` 返回 `roomTasks` |

**与外部「全栈方案讨论」的差异**：本仓库前端为 **原生 JS**（非 React/Vue 必选）；配对策略以 **`docs/产品描述.md` 第 5.3、9 节** 为准（**开场到点后首轮配对** + 停配 + 开场互配）；主题 **MVP 为固定集**（非 AI 自动生成档期）。若产品决策变更，先改 `docs/产品描述.md` 再改实现。

---

*本文档为开发与 Cursor 生成代码的架构依据；细节变更请同步更新本文件并留痕。*
