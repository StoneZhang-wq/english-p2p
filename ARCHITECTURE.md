# 英语口语真人匹配平台 — 项目架构与开发规范

本文档与 `docs/产品描述.md` 共同作为实现依据；**产品规则以产品描述为准**，**工程结构、接口与库表以本文为准**。若冲突，先对齐文档再改代码。

---

## 1. 项目概述

- **形态**：移动端网页优先（手机浏览器），用户通过**预约主题 + 时间段 + 口语水平**参与**角色扮演式**英语对话。
- **核心流程**：登录 → 浏览主题/场次 → **预约（受截止规则限制）** → **开场前 5 分钟配对** → 通知 → **个人中心/接口展示具体搭档（昵称、水平）** → 进入房间 → Agora 实时语音 → 结束并更新信用分。
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
│   ├── services/         # 邮件、短信、Agora Token 等
│   ├── utils/            # 验证码、配对算法等
│   ├── cron/             # 定时任务（开场前 5 分钟配对）
│   ├── public/           # 前端静态页（HTML/CSS/JS，express.static）
│   └── app.js            # Express 入口
├── db/
│   └── schema.postgres.sql # 建表脚本（见第 4 节）
├── docs/
│   ├── 产品描述.md
│   └── 产品与需求变更规则.md
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
| GET | `/api/themes` | 主题列表 |
| GET | `/api/timeslots` | Query：`theme_id`，可选 `date`；返回场次及**是否仍可预约**（含截止规则） |
| POST | `/api/book` | Body：`timeslot_id`, `level`；**受预约截止与容量约束** |
| GET | `/api/my-bookings` | 当前用户预约列表；**若已配对**，每条含 **搭档昵称 `partner_nickname`、搭档水平 `partner_level`**（不对用户暴露对方手机号） |
| DELETE | `/api/cancel-booking/:id` | 取消预约（需校验归属与业务允许取消的时间窗，产品未定时可默认开场前均可取消，**截止预约不影响已确认预约的主动取消**，除非产品另定） |
| GET | `/api/my-pair` | Query：`timeslot_id`；返回 **channel_name、agora_app_id、agora_token（可选）、搭档昵称、搭档水平、双方任务卡/角色** |
| POST | `/api/end-conversation` | Body：`pair_id`, `duration_seconds` 等；用于结算与信用分 |
| GET | `/api/user/profile` | 昵称、信用分等 |
| POST | `/api/agora/rtc-token` | Body：`{ channelName, uid }`；返回 `appId`、`channelName`、`token`、`uid`、`expiresIn`。**须开启声网 App Certificate**，Token 仅服务端生成；生产环境须叠加登录态与「用户属于该频道对应 pair」校验（当前为集成骨架） |

### 5.3 预约截止（强制）

- **规则**：当场次 `start_time` 与服务器当前时间（`Asia/Shanghai`）相差 **小于 60 分钟** 时，**禁止新建预约**该场次。
- **实现**：`POST /api/book` 事务前校验；`GET /api/timeslots` 对不可约场次返回 `can_book: false` 及文案（如「开场前 1 小时已截止预约」）。
- **已存在**的 `confirmed` 预约**不因截止而自动取消**（除非产品另定）。

### 5.4 配对结果与「具体对象是谁」

- 配对在**开场前 5 分钟**跑批生成 `pairs` 后：
  - **通知**（邮件/短信/Push）必须包含：**搭档昵称、搭档水平、进房链接**。
  - **个人中心 / 预约详情**与 **`GET /api/my-bookings`**、**`GET /api/my-pair`** 必须在数据层带出**当前用户对应的那一位搭档**的 `nickname` + `level`（实现上通过 `user_a`/`user_b` 与当前用户 id 判断对方用户行）。
- **禁止**在接口或前端对其他用户展示**手机号、邮箱**等敏感字段。

---

## 6. 关键业务逻辑（必须遵守）

### 6.1 预约容量

- 使用**数据库事务**；更新 `timeslots.booked_count` 前用 **`SELECT ... FOR UPDATE`**（或等价行锁）锁定场次行。
- 条件：`booked_count < max_pairs * 2` 方可新增一条 `confirmed` 预约。

### 6.2 配对算法（开场前 5 分钟）

- **输入**：该 `timeslot_id` 下所有 `status='confirmed'` 的 `bookings`（含 `level`）。
- **输出**：写入 `pairs`；`channel_name` 建议格式：`eng_{timeslot_id}_{pair_id}_{timestamp}`（仅服务端生成）。
- **约束**（与 `docs/产品描述.md` 一致）：两人等级差 **≤ 1**（0/1/2 映射初/中/高）；**优化目标**：最大化成对人数、最小化落单人数。实现方式不限（图匹配、ILP 等）。
- **兜底**：若无法全员配对，按产品描述执行**场次取消 + 全员通知 + 信用补偿 + 优先预约权**，且不扣用户分。

### 6.3 信用分（与产品描述一致）

- 初始 10；正常完成（双方确认且 **≥ 10 分钟**）**+1**；爽约 **-2**；早退（未满 10 分钟且无双方同意）**-1**；守约方因对方问题 **+1**；**≤ 3 分禁止预约**需管理员恢复。
- 所有变动写入 `credit_logs`。

### 6.4 房间与 Agora

- **Web SDK**：使用 **4.x**（如 `agora-rtc-sdk-ng@4.23.x` CDN：`AgoraRTC_N-production.js`）。
- **Token**：**必须**启用控制台 **App Certificate**，通过 `POST /api/agora/rtc-token` 获取 Token 后 `createClient` → `join(appId, channel, token, uid)` → `createMicrophoneAudioTrack` → `publish`；集成时可调用 `enableLogUpload` 便于排障。
- 前端仅使用接口返回的 `channel_name` / token / appId；**禁止**前端自拟频道名（演示页可通过 Query 传 `channel`、`uid`，上线后改为 `GET /api/my-pair` 下发）。
- iOS 非 Safari 麦克风限制：房间页**顶部红色提示**建议使用 Safari 或 Chrome。

### 6.5 定时任务（Cron）

- 建议**每 1 分钟**扫描：找出 `start_time` 落在 **当前时间 + 4～6 分钟**（或等价窗口）内、尚未完成配对派发的场次，执行配对与通知（避免仅依赖 5 分钟整点导致遗漏）。
- 时区：**Asia/Shanghai**。

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
- 应用启动：执行 `schema.postgres.sql`（`CREATE IF NOT EXISTS`）
- 生产：`pm2 start backend/app.js --name english-match`

---

## 10. 代码风格

- 后端：ESM 或 CJS 统一即可；**async/await**；`try/catch` 集中错误处理；配对等复杂逻辑**必须注释**思路。
- 前端：模块化（可拆 `js/*.js`）；HTTP 统一 **`fetch`**；避免污染全局。
- **产品/业务变更**：先改 `docs/产品描述.md`，再在 `docs/产品与需求变更规则.md`「变更记录」追加一行。

---

*本文档为开发与 Cursor 生成代码的架构依据；细节变更请同步更新本文件并留痕。*
