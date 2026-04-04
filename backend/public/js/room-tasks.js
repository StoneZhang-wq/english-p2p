/**
 * 任务确认：点击「完成」→ 等待对方确认（演示：定时模拟对方请求 + 本端确认条）
 * 接入 WebSocket 后替换为真实对端事件
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

  /** 演示：你点「完成」后，短暂延迟弹出「对方请你确认」条，模拟双向 */
  function simulatePartnerConfirmRequest(title, cb) {
    showToast("已通知对方，等待确认…", false);
    setTimeout(function () {
      showPartnerBar(title, function (result) {
        cb(result);
      });
    }, 800);
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

  if (!list) return;

  list.querySelectorAll(".task-confirm-card").forEach(function (card) {
    var btn = card.querySelector(".task-complete-btn");
    var titleEl = card.querySelector(".task-confirm-title");
    if (!btn || !titleEl) return;

    btn.addEventListener("click", function () {
      if (btn.disabled || btn.classList.contains("is-done")) return;
      btn.classList.add("is-waiting");
      btn.textContent = "等待确认…";
      btn.disabled = true;

      var title = titleEl.textContent.trim();

      simulatePartnerConfirmRequest(title, function (result) {
        if (result === "ok") {
          markCardDone(card, btn);
        } else if (result === "deny") {
          markCardRejected(card, btn);
        } else {
          markCardTimeout(card, btn);
        }
      });
    });
  });
})();
