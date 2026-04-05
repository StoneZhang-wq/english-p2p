/**
 * 我的预约：短轮询 GET /api/bookings/mine，展示搭档 / 进房链接；失败指数退避。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "appointments") return;

  var root = document.getElementById("liveBookings");
  var statusEl = document.getElementById("apptPollStatus");
  if (!root) return;

  var backoff = window.createPollBackoff ? window.createPollBackoff(8000, 60000) : null;
  var myUid = null;

  function setStatus(text, isErr) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.hidden = !text;
    statusEl.classList.toggle("appt-poll-status--error", !!isErr);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso.replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return iso;
    function p2(n) {
      return n < 10 ? "0" + n : String(n);
    }
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }

  function render(bookings) {
    root.innerHTML = "";
    if (!bookings || bookings.length === 0) {
      root.innerHTML =
        '<p class="booking-empty">暂无预约。<a href="index.html">去首页选主题</a></p>';
      return;
    }

    bookings.forEach(function (b) {
      var cap = b.maxPairs * 2;
      var tagClass = b.pairStatus === "confirmed" || b.channelName ? "done" : "pending";
      var tagText = b.channelName ? "已配对" : "待配对";
      var partnerLine = b.partnerNickname
        ? "搭档：" + esc(b.partnerNickname) + (b.partnerCreditScore != null ? "（信用 " + b.partnerCreditScore + "）" : "")
        : "搭档：配对完成后显示";

      var enter = "";
      if (b.channelName && myUid != null) {
        var href =
          "room.html?channel=" +
          encodeURIComponent(b.channelName) +
          "&uid=" +
          encodeURIComponent(String(myUid));
        enter = '<a class="btn-enter" href="' + href + '">进入房间</a>';
      }

      var art = document.createElement("article");
      art.className = "appt-card";
      art.innerHTML =
        '<div class="row-top">' +
        "<h2>" +
        esc(b.themeName) +
        '</h2><span class="status-tag ' +
        tagClass +
        '">' +
        esc(tagText) +
        "</span></div>" +
        '<div class="appt-meta">时间：' +
        esc(formatTime(b.startTime)) +
        "<br />人数：" +
        esc(b.bookedCount) +
        "/" +
        esc(cap) +
        "<br />" +
        partnerLine +
        "</div>" +
        enter;
      root.appendChild(art);
    });
  }

  function fetchMeUid() {
    return fetch("/api/auth/me", { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j.data && j.data.user) myUid = j.data.user.id;
      })
      .catch(function () {});
  }

  function loadMine() {
    return fetch("/api/bookings/mine", { credentials: "include" })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, j: j };
        });
      })
      .then(function (x) {
        if (x.status === 401) {
          root.innerHTML =
            '<p class="booking-empty">请先 <a href="login.html">登录</a> 查看预约。</p>';
          setStatus("");
          return true;
        }
        if (!x.ok || x.j.code !== 0) {
          throw new Error(x.j.message || "加载失败");
        }
        render(x.j.data.bookings);
        if (backoff) backoff.reset();
        setStatus("");
        return true;
      })
      .catch(function () {
        setStatus("网络不稳定，正在重连…", true);
        return false;
      });
  }

  function startLoop() {
    function tick() {
      loadMine().then(function (ok) {
        var wait = backoff ? backoff.next(ok) : 8000;
        setTimeout(tick, wait);
      });
    }
    setTimeout(tick, 8000);
  }

  fetchMeUid()
    .then(function () {
      return loadMine();
    })
    .then(function () {
      startLoop();
    });
})();
