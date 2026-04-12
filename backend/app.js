require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const { initDb, runWeeklyThemeMaintenance } = require("./db");
const authRouter = require("./routes/auth");
const timeslotsRouter = require("./routes/timeslots");
const bookingsRouter = require("./routes/bookings");
const agoraRouter = require("./routes/agora");
const previewMaterialRouter = require("./routes/previewMaterial");
const themesRouter = require("./routes/themes");
const { attachRoomTaskWebSocket } = require("./services/roomTaskWs");

const app = express();
app.set("trust proxy", 1);
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
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));

const publicDir = path.join(__dirname, "public");
if (!fs.existsSync(publicDir)) {
  console.warn(
    `[warn] 静态目录不存在: ${publicDir}\n` +
      "  请确认已提交 backend/public/（含 index.html），且工作目录为 backend/。"
  );
}
app.use(express.static(publicDir));

app.get("/api/health", (_req, res) => {
  res.json({ code: 0, message: "ok", data: { ts: Date.now() } });
});

app.use("/api/auth", authRouter);
app.use("/api/timeslots", timeslotsRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/agora", agoraRouter);
app.use("/api/preview-material", previewMaterialRouter);
app.use("/api/themes", themesRouter);

app.use((err, _req, res, _next) => {
  console.error("[express]", err);
  res.status(500).json({ code: 500, message: "服务器错误", data: null });
});

if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error("[错误] 生产环境必须设置 JWT_SECRET（至少 16 字符）");
    process.exit(1);
  }
} else if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.warn("[warn] 未设置 JWT_SECRET，开发环境使用内置弱密钥，请勿用于生产");
}

initDb()
  .then(() => {
    setInterval(function () {
      runWeeklyThemeMaintenance().catch(function (e) {
        console.error("[weekly-theme]", e && e.message ? e.message : e);
      });
    }, 10 * 60 * 1000);

    const server = app.listen(PORT);
    attachRoomTaskWebSocket(server);

    server.on("listening", () => {
      console.log(
        `Listening on port ${PORT} (process.env.PORT=${process.env.PORT !== undefined ? process.env.PORT : "unset, using 3000"})`
      );
      console.log(`Static files: ${publicDir}`);
      console.log(`CORS: ${origins.join(", ")}`);
      console.log("PostgreSQL: ready");
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
  })
  .catch((e) => {
    console.error("[错误] 数据库初始化失败:", e.message);
    process.exit(1);
  });
