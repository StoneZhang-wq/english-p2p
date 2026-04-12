# 英语口语真人匹配练习（P2P Chat）

移动端网页 + Node/Express 声网 Token 服务 + 静态前端。详见 `ARCHITECTURE.md` 与 `docs/`。

## 本地运行

```bash
# 先准备 PostgreSQL，并创建空库（例如库名 p2p_chat）
cd backend
cp .env.example .env   # 填写 DATABASE_URL、JWT_SECRET、声网密钥等
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

数据：**PostgreSQL**（**`DATABASE_URL`** 连接串；驱动 **`pg`**）。启动时执行 **`backend/schema.postgres.sql`**（或 monorepo 下 `db/schema.postgres.sql`），`CREATE IF NOT EXISTS` 可重复执行。表结构变更时请同步 **`db/schema.postgres.sql` 与 `backend/schema.postgres.sql`**。若已有表但缺 `users.password_hash`，启动时会自动补列。

> 历史：`db/schema.sql` 为早期 SQLite 脚本，仅供参考。

### 预约与场次 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/themes` | 当前周三个主题（周日 19:00 上海起开放下一周） |
| GET | `/api/timeslots?theme_id=1` | **`theme_id` 必填**（数字 id，来自 `/api/themes`） |
| POST | `/api/bookings` | 需登录；Body `{ timeslot_id, level }`，`level`：`beginner` / `mid` / `adv` 或 `intermediate` 等 |
| GET | `/api/bookings/mine` | 需登录；返回预约列表及搭档、`channel_name`（配对后） |

预约写入使用 **事务 + `SELECT … FOR UPDATE`** 锁定场次行，校验 `status = 'open'` 与 `booked_count < max_pairs * 2`，防止超卖。

启动与定时任务会按**周主题轮换规则**补全 `themes` / `timeslots`（见 `ARCHITECTURE.md`）。

**尚未实现**（按 `ARCHITECTURE.md` 后续迭代）：开场前 cron 配对算法、`pairs` 写入、邮件通知、**`POST /api/agora/rtc-token` 与登录态及 pair 绑定校验**（当前仍为演示级 Token）。配对可用一般图最大匹配（等级差≤1）在 `O(n³)` 内完成。

### 声网联调（免预约）

部署后可直接打开 **`/agora-test.html`**，按页内两个链接用 **不同 uid** 进同一频道；或手动访问  
`room.html?channel=cloud-dev&uid=10001` 与 `room.html?channel=cloud-dev&uid=10002`。  
**无需**先预约。上线前请为 `rtc-token` 增加鉴权与 pair 校验。

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
- **PostgreSQL**：在 Railway 项目里 **New → Database → PostgreSQL**（或 **Add Postgres** 到当前服务），平台会把 **`DATABASE_URL`** 注入你的 Web 服务，**无需再配 SQLite**。
- **Variables**：`DATABASE_URL`（一般由 Postgres 插件自动提供）、`JWT_SECRET`（≥16 字符）、`NODE_ENV=production`、`AGORA_*`、`CORS_ORIGINS`（含 `https://…up.railway.app`）。
- 应用启动时会跑 **`schema.postgres.sql`** 建表；演示场次仅在 **`timeslots` 为空** 时插入。
