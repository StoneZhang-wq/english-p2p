const WebSocket = require("ws");

/**
 * 同 Agora 频道内的任务完成确认信令（1 对 1）：完成方发请求，对端弹出确认条，结果回传完成方。
 * @param {import("http").Server} server
 */
function attachRoomTaskWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true });

  /** @type {Map<string, Map<number, import("ws").WebSocket>>} */
  const rooms = new Map();

  function leaveRoom(ws) {
    const meta = ws._roomMeta;
    if (!meta) return;
    const { channel, uid } = meta;
    const m = rooms.get(channel);
    if (m) {
      if (m.get(uid) === ws) m.delete(uid);
      if (m.size === 0) rooms.delete(channel);
    }
    delete ws._roomMeta;
  }

  server.on("upgrade", (request, socket, head) => {
    let url;
    try {
      const host = request.headers.host || "localhost";
      url = new URL(request.url || "/", `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }

    /* 非本 WebSocket 路径必须关闭 socket，否则半开连接会堆积并拖垮同进程的 HTTP/API（含 rtc-token） */
    if (url.pathname !== "/ws/room") {
      socket.destroy();
      return;
    }

    const channel = url.searchParams.get("channel") || "";
    const uid = Number(url.searchParams.get("uid"));
    if (!channel || !Number.isFinite(uid) || uid <= 0) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, { channel, uid });
      });
    } catch (e) {
      console.warn("[ws/room] handleUpgrade", e && e.message);
      socket.destroy();
    }
  });

  wss.on("connection", (ws, { channel, uid }) => {
    if (!rooms.has(channel)) rooms.set(channel, new Map());
    const m = rooms.get(channel);
    const old = m.get(uid);
    if (old && old !== ws) {
      try {
        old.close(4000, "replaced");
      } catch (_) {}
    }
    m.set(uid, ws);
    ws._roomMeta = { channel, uid };

    ws.on("close", () => leaveRoom(ws));
    ws.on("error", () => leaveRoom(ws));

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const meta = ws._roomMeta;
      if (!meta || !msg || typeof msg.type !== "string") return;

      if (msg.type === "task_complete_request") {
        const room = rooms.get(meta.channel);
        if (!room) return;
        const payload = JSON.stringify({
          type: "task_confirm_prompt",
          requestId: msg.requestId,
          taskId: msg.taskId,
          title: msg.title,
          fromUid: meta.uid,
        });
        for (const [otherUid, otherWs] of room) {
          if (otherUid !== meta.uid && otherWs.readyState === WebSocket.OPEN) {
            otherWs.send(payload);
          }
        }
        return;
      }

      if (msg.type === "task_confirm_response") {
        const room = rooms.get(meta.channel);
        if (!room) return;
        const targetUid = Number(msg.targetUid);
        if (!Number.isFinite(targetUid)) return;
        const allowed = new Set(["ok", "deny", "timeout"]);
        const result = allowed.has(msg.result) ? msg.result : "deny";
        const targetWs = room.get(targetUid);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(
            JSON.stringify({
              type: "task_confirm_result",
              requestId: msg.requestId,
              taskId: msg.taskId,
              result,
            })
          );
        }
      }
    });
  });
}

module.exports = { attachRoomTaskWebSocket };
