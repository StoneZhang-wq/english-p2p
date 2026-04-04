# 英语口语真人匹配练习（P2P Chat）

移动端网页 + Node/Express 声网 Token 服务 + 静态前端。详见 `ARCHITECTURE.md` 与 `docs/`。

## 本地运行

```bash
cd backend
cp .env.example .env   # 填写声网 App ID / Certificate
npm install
npm run dev
```

浏览器打开 `http://localhost:3000/index.html`（端口以 `.env` 为准）。

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

- **端口**：应用已使用环境变量 `process.env.PORT`（Railway 自动注入）。日志里的 `Listening on port 8080` 表示平台分配了 8080，**不是**代码写死。
- **静态页打不开（Cannot GET /index.html）**：需保证容器内存在与 `backend/` 同级的 **`web/`**。建议 **Root Directory 留空（仓库根）**，**Install**：`cd backend && npm install`，**Start**：`cd backend && node app.js`。若 Root 仅设为 `backend` 且构建不包含上级目录，会导致 `web` 缺失。
- **Variables**：`AGORA_APP_ID`、`AGORA_APP_CERTIFICATE`、`CORS_ORIGINS`（含你的 `https://…up.railway.app`）。勿手动覆盖 `PORT`，除非你知道在做什么。
