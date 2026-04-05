/**
 * 任务确认：点击「完成」→ 经 WebSocket 通知同频道对端弹出确认条 → 结果回传完成方
 */
(function () {
  var list = document.getElementById("taskConfirmList");
  var bar = document.getElementById("partnerConfirmBar");
  var barText = document.getElementById("partnerConfirmText");
  var btnOk = document.getElementById("partnerOk");
  var btnDeny = document.getElementById("partnerDeny");

  function showToast(msg, isError) {
    var el = document.getElementById("roomToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("room-toast--error", !!isError);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.hidden = true;
    }, 3200);
  }

  var pendingResolve = null;
  var pendingTimer = null;

  function hidePartnerBar() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    bar.hidden = true;
    pendingResolve = null;
  }

  function showPartnerBar(title, onResult) {
    barText.textContent = "对方声称完成了「" + title + "」，是否确认？";
    bar.hidden = false;
    pendingResolve = onResult;
    pendingTimer = setTimeout(function () {
      if (pendingResolve) {
        var fn = pendingResolve;
        hidePartnerBar();
        fn("timeout");
      }
    }, 10000);
  }

  if (btnOk) {
    btnOk.addEventListener("click", function () {
      if (!pendingResolve) return;
      var fn = pendingResolve;
      hidePartnerBar();
      fn("ok");
    });
  }
  if (btnDeny) {
    btnDeny.addEventListener("click", function () {
      if (!pendingResolve) return;
      var fn = pendingResolve;
      hidePartnerBar();
      fn("deny");
    });
  }

  function markCardDone(card, btn) {
    card.classList.add("is-done");
    btn.disabled = true;
    btn.textContent = "已完成";
    btn.classList.remove("is-waiting");
    btn.classList.add("is-done");
    showToast("+10 能量", false);
  }

  function markCardRejected(card, btn) {
    btn.disabled = false;
    btn.textContent = "完成";
    btn.classList.remove("is-waiting", "is-done");
    showToast("对方否认，任务未完成", true);
  }

  function markCardTimeout(card, btn) {
    btn.disabled = false;
    btn.textContent = "完成";
    btn.classList.remove("is-waiting");
    showToast("确认超时，未计入能量（可稍后补确认）", false);
  }

  function markCardDisconnect(card, btn) {
    btn.disabled = false;
    btn.textContent = "完成";
    btn.classList.remove("is-waiting");
    showToast("连接已断开，请刷新后重试", true);
  }

  function newRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "r" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
  }

  function queryRoomIdentity() {
    var params = new URLSearchParams(window.location.search);
    return {
      channel: params.get("channel") || "demo_eng_local",
      uid: Number(params.get("uid") || "10001"),
    };
  }

  function buildWsUrl() {
    var q = queryRoomIdentity();
    var proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return (
      proto +
      "//" +
      window.location.host +
      "/ws/room?channel=" +
      encodeURIComponent(q.channel) +
      "&uid=" +
      encodeURIComponent(String(q.uid))
    );
  }

  var ws = null;
  var wsReady = false;
  var reconnectTimer = null;
  /** @type {Record<string, { timeoutId: number, card: HTMLElement, btn: HTMLButtonElement }>} */
  var waiterByRequestId = Object.create(null);

  function clearWaiter(requestId, run) {
    var w = waiterByRequestId[requestId];
    if (!w) return;
    delete waiterByRequestId[requestId];
    clearTimeout(w.timeoutId);
    if (run) run(w.card, w.btn);
  }

  function failAllWaiters() {
    Object.keys(waiterByRequestId).forEach(function (rid) {
      clearWaiter(rid, function (card, btn) {
        markCardDisconnect(card, btn);
      });
    });
  }

  function applyResultToCard(card, btn, result) {
    if (result === "ok") {
      markCardDone(card, btn);
    } else if (result === "deny") {
      markCardRejected(card, btn);
    } else if (result === "disconnect") {
      markCardDisconnect(card, btn);
    } else {
      markCardTimeout(card, btn);
    }
  }

  function connectWs() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      ws = new WebSocket(buildWsUrl());
    } catch (e) {
      console.error(e);
      reconnectTimer = setTimeout(connectWs, 3000);
      return;
    }

    ws.onopen = function () {
      wsReady = true;
    };

    ws.onclose = function () {
      wsReady = false;
      ws = null;
      failAllWaiters();
      reconnectTimer = setTimeout(connectWs, 3000);
    };

    ws.onerror = function () {};

    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "task_confirm_prompt") {
        var title = String(msg.title || "");
        var requestId = msg.requestId;
        var fromUid = msg.fromUid;
        var taskId = msg.taskId;
        showPartnerBar(title, function (result) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              type: "task_confirm_response",
              requestId: requestId,
              taskId: taskId,
              result: result,
              targetUid: fromUid,
            })
          );
        });
        return;
      }

      if (msg.type === "task_confirm_result") {
        var rid = msg.requestId;
        clearWaiter(rid, function (card, btn) {
          applyResultToCard(card, btn, msg.result);
        });
      }
    };
  }

  if (!list) return;

  connectWs();

  list.querySelectorAll(".task-confirm-card").forEach(function (card) {
    var btn = card.querySelector(".task-complete-btn");
    var titleEl = card.querySelector(".task-confirm-title");
    if (!btn || !titleEl) return;

    btn.addEventListener("click", function () {
      if (btn.disabled || btn.classList.contains("is-done")) return;
      if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) {
        showToast("信令未连接，请稍候或刷新页面", true);
        return;
      }

      btn.classList.add("is-waiting");
      btn.textContent = "等待确认…";
      btn.disabled = true;

      var title = titleEl.textContent.trim();
      var requestId = newRequestId();
      var taskId = card.getAttribute("data-task-id") || "";

      waiterByRequestId[requestId] = {
        timeoutId: setTimeout(function () {
          clearWaiter(requestId, function (c, b) {
            markCardTimeout(c, b);
          });
        }, 120000),
        card: card,
        btn: btn,
      };

      try {
        ws.send(
          JSON.stringify({
            type: "task_complete_request",
            requestId: requestId,
            taskId: taskId,
            title: title,
          })
        );
        showToast("已通知对方，等待确认…", false);
      } catch (e) {
        clearWaiter(requestId, function (c, b) {
          b.disabled = false;
          b.textContent = "完成";
          b.classList.remove("is-waiting");
        });
        showToast("发送失败，请重试", true);
      }
    });
  });
})();
