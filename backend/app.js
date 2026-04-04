require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const agoraRouter = require("./routes/agora");

const app = express();
// Railway / 云平台会注入 PORT；本地默认 3000。勿在代码里写死端口。
const PORT = Number(process.env.PORT) || 3000;

const origins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: origins,
    credentials: true,
  })
);
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ code: 0, message: "ok", data: { ts: Date.now() } });
});

app.use("/api/agora", agoraRouter);

// 同机托管 web 静态资源（__dirname 为 backend/，上一级为仓库根）
const webStatic = path.join(__dirname, "..", "web");
if (!fs.existsSync(webStatic)) {
  console.warn(
    `[warn] 静态目录不存在: ${webStatic}\n` +
      "  若部署在 Railway：Root Directory 请用仓库根目录，Start 用 `cd backend && node app.js`，\n" +
      "  或保证构建产物里包含与 backend 同级的 web/。"
  );
}
app.use(express.static(webStatic));

// 勿把 listen 的回调当作「唯一回调」：端口被占用时 Express 仍会调用该函数，
// 容易误报「已启动」随后进程因无监听而立刻退出（nodemon 显示 clean exit）。
const server = app.listen(PORT);

server.on("listening", () => {
  console.log(
    `Listening on port ${PORT} (process.env.PORT=${process.env.PORT !== undefined ? process.env.PORT : "unset, using 3000"})`
  );
  console.log(`Static files: ${webStatic}`);
  console.log(`CORS: ${origins.join(", ")}`);
  if (!process.env.AGORA_APP_CERTIFICATE) {
    console.warn("[warn] 未设置 AGORA_APP_CERTIFICATE，/api/agora/rtc-token 将返回 503");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[错误] 端口 ${PORT} 已被占用（例如本机其它项目 MIROFISH / Next 等）。\n` +
        `请关闭占用进程，或在 backend/.env 中设置 PORT=3010 后重启。`
    );
  } else {
    console.error("[错误] 服务器无法监听:", err.message);
  }
  process.exit(1);
});
