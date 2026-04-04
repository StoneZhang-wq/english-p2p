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
