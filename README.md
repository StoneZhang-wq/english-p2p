# 英语口语真人匹配练习（P2P Chat）

移动端网页 + Node/Express 声网 Token 服务 + 静态前端。详见 `ARCHITECTURE.md` 与 `docs/`。

## 本地运行

```bash
cd backend
cp .env.example .env   # 填写 JWT_SECRET、声网 App ID / Certificate 等
npm install
npm run dev
```

浏览器打开 `http://localhost:3000/index.html`（端口以 `.env` 为准）。首页可 **注册 / 登录**；登录态使用 **httpOnly Cookie**（`credentials: 'include'`），`CORS_ORIGINS` 须包含当前访问来源。

### 认证 API（MVP）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | Body: `{ email, password, nickname }`，成功则 Set-Cookie |
| POST | `/api/auth/login` | Body: `{ email, password }` |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/auth/me` | 返回 `{ user }` 或 `user: null` |

数据：**SQLite**（默认 **`backend/data/app.db`**；建表脚本优先读 **`backend/schema.sql`**，本地 monorepo 亦可使用 `db/schema.sql`）。驱动为 Node **内置 `node:sqlite`**（建议 **Node ≥ 22.5**）。表结构变更时请同步 **`db/schema.sql` 与 `backend/schema.sql`**。后续业务路由可用 `middleware/requireAuth.js` 的 `requireAuth` 保护。

**已有旧库**：若 `users` 表无 `password_hash` 列，启动时会自动 `ALTER TABLE` 补列；旧行需重新注册或自行补密码哈希。

### 预约与场次 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/timeslots?theme=interview` | `theme`：`interview` / `ielts` / `chat`（与首页链接一致）；或 `theme_id` 数字 |
| POST | `/api/bookings` | 需登录；Body `{ timeslot_id, level }`，`level`：`beginner` / `mid` / `adv` 或 `intermediate` 等 |
| GET | `/api/bookings/mine` | 需登录；返回预约列表及搭档、`channel_name`（配对后） |

预约写入使用 **`BEGIN IMMEDIATE`** 事务，校验 `status = 'open'` 与 `booked_count < max_pairs * 2`，与文档中的防超卖一致。

首次启动且**无任何场次**时，会自动插入演示主题与场次（仅当 `timeslots` 表为空）。

**尚未实现**（按 `ARCHITECTURE.md` 后续迭代）：开场前 cron 配对算法、`pairs` 写入、邮件通知、**`POST /api/agora/rtc-token` 与登录态及 pair 绑定校验**（当前仍为演示级 Token）。配对可用一般图最大匹配（等级差≤1）在 `O(n³)` 内完成。

## 推送到 GitHub（首次）

1. 在 [github.com/new](https://github.com/new) 新建仓库（不要勾选「Add README」）。
2. 在本项目根目录执行（将 `YOUR_USER` / `YOUR_REPO` 换成你的）：

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

若使用 SSH：`git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git`

登录可用浏览器 Personal Access Token（HTTPS）或本机 SSH 公钥。

**注意**：`backend/.env` 已加入 `.gitignore`，勿把声网密钥提交到仓库。

## Railway 部署说明

- **端口**：应用使用 `process.env.PORT`（平台自动注入），勿在 Railway 里随意覆盖 `PORT`。
- **Root Directory**：设为 **`backend`**（与 `package.json` 同级）。静态文件在 **`backend/public/`**，与 `app.js` 同根，避免「只上传 backend 子目录丢前端」的问题。
- **构建 / 启动**（Root = `backend` 时）：**Install** `npm install`，**Start** `npm start`（或 `node app.js`）。
- **若 Root 留空（仓库根）**：**Install** `cd backend && npm install`，**Start** `cd backend && node app.js`。
- **Variables**：`JWT_SECRET`（≥16 字符，生产必填）、`NODE_ENV=production`、`AGORA_APP_ID`、`AGORA_APP_CERTIFICATE`、`CORS_ORIGINS`（含你的 `https://…up.railway.app`）。
- **数据库**：镜像内含 **`backend/schema.sql`**（Root=`backend` 时也会执行建表）。默认库文件 **`backend/data/app.db`**。文件系统**非持久**时重部署会清空数据；要保留请挂 **Volume** 并设置 **`DB_PATH`**（如 `/data/app.db`），或改用 PostgreSQL。
