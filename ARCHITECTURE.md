# 英语口语真人匹配平台 — 项目架构与开发规范

本文档与 `docs/产品描述.md` 共同作为实现依据；**产品规则以产品描述为准**，**工程结构、接口与库表以本文为准**。若冲突，先对齐文档再改代码。

---

## 1. 项目概述

- **形态**：移动端网页优先（手机浏览器），用户通过**预约主题 + 时间段 + 口语水平**参与**角色扮演式**英语对话。
- **核心流程**：登录 → 浏览主题/场次 → **预约（受截止规则限制）** → **尽早配对 + 通知** → **个人中心/接口展示具体搭档（昵称、水平）** → **停配扫描 / 开场落单互配（若需要）** → 进入房间 → Agora 实时语音 → 结束并更新信用分。
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
│   ├── public/           # 前端静态页（HTML/CSS/JS，express.static）
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
| POST | `/api/agora/rtc-token` | Body：`{ channelName, uid }`；返回 `appId`、`channelName`、`token`、`uid`、`expiresIn`。**须开启声网 App Certificate**，Token 仅服务端生成；生产环境须叠加登录态与「用户属于该频道对应 pair」校验（当前为集成骨架） |

**开发调试（非正式配对）**：当 `NODE_ENV !== 'production'` **或** `ENABLE_DEV_PAIRING=1` 时挂载 `routes/devPairing.js`（否则不注册该路径）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/dev/pair-timeslot` | Body：`{ timeslot_id }`（整数）。**须登录**；调用者须在该场次有 `confirmed` 预约，且存在另一名同场次预约者与其**口语等级差≤1**（`utils/levelCompatibility.js`）；事务内 **删除该场次全部 `pairs`** 后 **INSERT** 一行（`channel_name` 形如 `dev_eng_{timeslotId}_{ts}`，满足声网频道字符集）。**禁止**在生产长期开启 `ENABLE_DEV_PAIRING`；正式「尽早配对」仍须独立实现。 |

### 5.3 预约截止（强制）

- **规则**：当场次 `start_time` 与服务器当前时间（`Asia/Shanghai`）相差 **小于 60 分钟** 时，**禁止新建预约**该场次。
- **实现**：`POST /api/book` 事务前校验；`GET /api/timeslots` 对不可约场次返回 `can_book: false` 及文案（如「开场前 1 小时已截止预约」）。
- **已存在**的 `confirmed` 预约**不因截止而自动取消**（除非产品另定）。

### 5.4 配对结果与「具体对象是谁」

- 配对策略以 `docs/产品描述.md` **第 5.3、9 节**为准：**尽早配对**、**取消触发的重配**、**开场前 60 分钟停约停首次配对**、**停配时刻全员可配性检查**、**开场落单互配**。
- 每次 `pairs` 写入或变更后：
  - **通知**（邮件/短信/Push）须覆盖产品第 10 节所列关键事件（首次成对、重配、场次取消、新搭档分配等）。
  - **个人中心 / 预约详情**与 **`GET /api/bookings/mine`**（及未来的 **`GET /api/my-pair`**）必须在数据层带出**当前用户对应的那一位搭档**的 `nickname` + `level`（实现上通过 `user_a`/`user_b` 与当前用户 id 判断对方用户行）；**频道名**仅服务端生成。
- **禁止**在接口或前端对其他用户展示**手机号、邮箱**等敏感字段。

---

## 6. 关键业务逻辑（必须遵守）

### 6.1 预约容量

- 使用**数据库事务**；更新 `timeslots.booked_count` 前用 **`SELECT ... FOR UPDATE`**（或等价行锁）锁定场次行。
- 条件：`booked_count < max_pairs * 2` 方可新增一条 `confirmed` 预约。

### 6.2 配对算法（持续 + 停配 + 开场）

- **输入**：同一 `timeslot_id`（及同一主题）下 `status='confirmed'` 的 `bookings`（含 `level`）；以及开场签到窗口内识别出的**落单池**用户集合（用于二次配对）。
- **输出**：创建/更新/解除 `pairs` 行；`channel_name` 建议格式：`eng_{timeslot_id}_{pair_id}_{timestamp}`（仅服务端生成；**重配时须换新频道标识**以免串线）。
- **约束**（与 `docs/产品描述.md` 第 9 节一致）：两人等级差 **≤ 1**；**优化目标**：最大化成对人数、最小化落单人数。实现方式不限（图匹配、ILP、增量匹配等）。
- **触发时机**（须拆服务或统一调度器，实现不限定）：
  1. **预约成功 / 取消 / 停配前轮询**：任意导致预约集合变化的事件后尝试配对或拆对重配。
  2. **停配时刻**（`start_time - 60min`，`Asia/Shanghai`）：停止新的**首次**配对；扫描是否全员可合法成对；否则执行第 7 节兜底。
  3. **开场到点**：根据「已上线 / 未上线」判定，对落单用户在同场次内执行**二次配对**并通知。
- **兜底**：停配扫描仍无法全员合法成对时，按产品描述执行**场次取消 + 全员通知 + 信用补偿 + 优先预约权**，且不扣用户分。
- **「已上线」判定**（须文档化并在接口中体现）：例如进房页心跳、`joinChannel` 成功回调、或显式签到 API；具体字段在实现阶段补充至本文与 OpenAPI/README。

### 6.3 信用分（与产品描述一致）

- 初始 10；正常完成（双方确认且 **≥ 10 分钟**）**+1**；爽约 **-2**；早退（未满 10 分钟且无双方同意）**-1**；守约方因对方问题 **+1**；**≤ 3 分禁止预约**需管理员恢复。
- 所有变动写入 `credit_logs`。

### 6.4 房间与 Agora

- **Web SDK**：使用 **4.x**（如 `agora-rtc-sdk-ng@4.23.x` CDN：`AgoraRTC_N-production.js`）。
- **Token**：**必须**启用控制台 **App Certificate**，通过 `POST /api/agora/rtc-token` 获取 Token 后 `createClient` → `join(appId, channel, token, uid)` → `createMicrophoneAudioTrack` → `publish`；集成时可调用 `enableLogUpload` 便于排障。
- 前端仅使用接口返回的 `channel_name` / token / appId；**禁止**前端自拟频道名（演示页可通过 Query 传 `channel`、`uid`，上线后改为 `GET /api/my-pair` 下发）。
- iOS 非 Safari 麦克风限制：房间页**顶部红色提示**建议使用 Safari 或 Chrome。

### 6.5 定时任务（Cron）与事件

- **配对与停配**：建议**每 1 分钟**（或更短）扫描：距 `start_time` 已进入「可预约窗口内」的场次，对未配对集合执行增量配对；对 **`start_time - 60min`** 已过的场次执行停配扫描与第 7 节检查。
- **开场落单互配**：在 `start_time`（或签到截止）到达时触发任务，读取签到状态，更新 `pairs` 并发送通知。
- **事件驱动**：`POST /api/bookings` 成功、`DELETE /api/cancel-booking/:id` 等路径**须入队或同步调用**配对尝试，以满足「尽早配对」与「取消后重配」（配对服务落地后接上）。
- 时区：**Asia/Shanghai**。

### 6.6 周主题的「当前开放周」（`weekThemeCycle.js`）

- **`getActiveThemeWeekMondayNow()`**：在所有满足「已过该周 `bookingOpensAt`」且「当前时刻早于该周 `weekCycleEndsAt`」的上海周一起算的自然周中，返回 **周一 `YYYY-MM-DD` 最大**的一周。避免周日 19:00 起下一周已开放、但本周周期尚未到周日 21:00 结束时，仍把「本周」当作活跃周而导致首页与预约仅展示**已截止**的本周场次。
- **`getWeekMondaysToEnsure()`**：可返回**多个**周（含重叠窗口内的两周），供启动/定时任务补全 `themes` 与 `timeslots`。

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
```

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
| 配对（尽早 / 取消重配 / 停配 / 开场互配） | **未做**：无 `cron/` 与事件驱动配对、`pairs` 写入与通知发送 |
| 我的预约 | `GET /api/bookings/mine`：含 `LEFT JOIN pairs` 展示搭档昵称等（若库中已有配对行） |
| Agora | `POST /api/agora/rtc-token`：需 `AGORA_APP_CERTIFICATE`；**须补**登录用户与 `channel_name` 所属 `pairs` 的校验（见 `routes/agora.js` 注释） |
| 房间页 | `public/room.html`、`js/room-agora.js`、`js/room-tasks.js`、`services/roomTaskWs.js` |
| 信用分结算 | `credit_logs` 表已建；**无** `POST /api/end-conversation` 等与产品一致的结算链路 |

**与外部「全栈方案讨论」的差异**：本仓库前端为 **原生 JS**（非 React/Vue 必选）；配对策略以 **`docs/产品描述.md` 第 5.3、9 节** 为准（尽早配对 + 停配 + 开场互配，非单一「开场前 5 分钟批处理」）；主题 **MVP 为固定集**（非 AI 自动生成档期）。若产品决策变更，先改 `docs/产品描述.md` 再改实现。

---

*本文档为开发与 Cursor 生成代码的架构依据；细节变更请同步更新本文件并留痕。*
