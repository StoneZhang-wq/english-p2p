/**
 * 我的预约：短轮询 GET /api/bookings/mine；分「即将开始 / 过往记录」Tabs。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "appointments") return;

  var panelUp = document.getElementById("panelUpcoming");
  var panelPast = document.getElementById("panelPast");
  var statusEl = document.getElementById("apptPollStatus");
  var tabUp = document.getElementById("tabUpcoming");
  var tabPast = document.getElementById("tabPast");
  if (!panelUp || !panelPast) return;

  var backoff = window.createPollBackoff ? window.createPollBackoff(8000, 60000) : null;
  var myUid = null;
  var activeTab = "upcoming";

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

  var SHANGHAI_TZ = "Asia/Shanghai";

  function parseDbTime(s) {
    if (!s) return null;
    var str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str) && !/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) {
      var iso = str.replace(" ", "T");
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ":00";
      var d0 = new Date(iso + "+08:00");
      return Number.isNaN(d0.getTime()) ? null : d0;
    }
    var d = new Date(str.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    var d = parseDbTime(iso);
    if (!d) return String(iso);
    function p2(n) {
      return n < 10 ? "0" + n : String(n);
    }
    var ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: SHANGHAI_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    var hh = "",
      mm = "";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === "hour") hh = p2(Number(p.value));
      if (p.type === "minute") mm = p2(Number(p.value));
    }
    return ymd + " " + hh + ":" + mm;
  }

  function isPastBooking(b) {
    var now = Date.now();
    if (String(b.bookingStatus || "").toLowerCase() !== "confirmed") return true;
    if (String(b.slotStatus || "").toLowerCase() === "cancelled") return true;
    var end = parseDbTime(b.endTime);
    if (end && end.getTime() < now) return true;
    return false;
  }

  function renderCard(b, past) {
    var cap = (b.maxPairs || 0) * 2;
    var tagText;
    var tagClass;
    if (past) {
      tagClass = "past";
      tagText = String(b.slotStatus || "").toLowerCase() === "cancelled" ? "已取消" : "已结束";
    } else if (b.channelName) {
      tagClass = "paired";
      tagText = "已配对";
    } else {
      tagClass = "pending";
      tagText = "待匹配";
    }

    var partnerLine = b.partnerNickname
      ? "搭档：" + esc(b.partnerNickname) + (b.partnerCreditScore != null ? "（信用 " + b.partnerCreditScore + "）" : "")
      : past
        ? "搭档：—"
        : "搭档：配对完成后显示";

    var enter = "";
    if (!past && myUid != null) {
      if (b.channelName) {
        var href =
          "room.html?channel=" +
          encodeURIComponent(b.channelName) +
          "&uid=" +
          encodeURIComponent(String(myUid));
        enter = '<a class="btn-enter" href="' + href + '">进入房间</a>';
      } else {
        enter =
          '<button type="button" class="btn-enter btn-enter--disabled" disabled aria-disabled="true" title="配对完成后可进入">进入房间</button>';
      }
    }

    var cancelBlock = "";
    if (!past) {
      cancelBlock =
        '<div class="cancel-flow">' +
        '<button type="button" class="cancel-trigger">取消预约</button>' +
        '<div class="cancel-panel" hidden>' +
        '<p class="cancel-ask">确定取消该预约？取消后可再次预约其他场次。</p>' +
        '<div class="cancel-btns">' +
        '<button type="button" class="btn-cancel-dismiss">保留</button>' +
        '<button type="button" class="btn-cancel-confirm">确定取消</button>' +
        "</div></div></div>";
    }

    var art = document.createElement("article");
    art.className = "appt-card";
    art.dataset.bookingId = String(b.id);
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
      enter +
      cancelBlock;
    return art;
  }

  function renderPanels(bookings) {
    panelUp.innerHTML = "";
    panelPast.innerHTML = "";
    if (!bookings || bookings.length === 0) {
      panelUp.innerHTML =
        '<p class="appt-empty">暂无预约。<a href="index.html">去首页选主题</a></p>';
      panelPast.innerHTML = '<p class="appt-empty">暂无过往记录。</p>';
      return;
    }

    var upcoming = [];
    var past = [];
    bookings.forEach(function (b) {
      if (isPastBooking(b)) past.push(b);
      else upcoming.push(b);
    });

    if (upcoming.length === 0) {
      panelUp.innerHTML = '<p class="appt-empty">暂无即将开始的场次。</p>';
    } else {
      upcoming.forEach(function (b) {
        panelUp.appendChild(renderCard(b, false));
      });
    }

    if (past.length === 0) {
      panelPast.innerHTML = '<p class="appt-empty">暂无过往记录。</p>';
    } else {
      past.forEach(function (b) {
        panelPast.appendChild(renderCard(b, true));
      });
    }
  }

  function setTab(tab) {
    activeTab = tab;
    var up = tab === "upcoming";
    if (tabUp) {
      tabUp.classList.toggle("appt-tab--active", up);
      tabUp.setAttribute("aria-selected", up ? "true" : "false");
    }
    if (tabPast) {
      tabPast.classList.toggle("appt-tab--active", !up);
      tabPast.setAttribute("aria-selected", up ? "false" : "true");
    }
    panelUp.hidden = !up;
    panelPast.hidden = up;
  }

  if (tabUp && tabPast) {
    tabUp.addEventListener("click", function () {
      setTab("upcoming");
    });
    tabPast.addEventListener("click", function () {
      setTab("past");
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
          panelUp.innerHTML = '<p class="booking-empty">请先 <a href="login.html">登录</a> 查看预约。</p>';
          panelPast.innerHTML = "";
          setStatus("");
          return true;
        }
        if (!x.ok || x.j.code !== 0) {
          throw new Error(x.j.message || "加载失败");
        }
        renderPanels(x.j.data.bookings);
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

  setTab("upcoming");

  panelUp.addEventListener("click", function (ev) {
    var el = ev.target;
    if (!el || typeof el.closest !== "function") return;

    var trigger = el.closest(".cancel-trigger");
    if (trigger) {
      var flow = trigger.closest(".cancel-flow");
      if (flow) {
        var pan = flow.querySelector(".cancel-panel");
        if (pan) pan.hidden = false;
      }
      return;
    }

    var dismiss = el.closest(".btn-cancel-dismiss");
    if (dismiss) {
      var flow2 = dismiss.closest(".cancel-flow");
      if (flow2) {
        var pan2 = flow2.querySelector(".cancel-panel");
        if (pan2) pan2.hidden = true;
      }
      return;
    }

    var confirmBtn = el.closest(".btn-cancel-confirm");
    if (confirmBtn) {
      var card = confirmBtn.closest("[data-booking-id]");
      if (!card) return;
      var bookingId = card.getAttribute("data-booking-id");
      if (!bookingId) return;
      confirmBtn.disabled = true;
      fetch("/api/cancel-booking/" + encodeURIComponent(bookingId), {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, j: j };
          });
        })
        .then(function (x) {
          if (x.status === 401) {
            window.location.href = "login.html";
            return;
          }
          if (!x.ok || x.j.code !== 0) {
            setStatus(x.j.message || "取消失败", true);
            confirmBtn.disabled = false;
            return;
          }
          var flow3 = confirmBtn.closest(".cancel-flow");
          if (flow3) {
            var pan3 = flow3.querySelector(".cancel-panel");
            if (pan3) pan3.hidden = true;
          }
          loadMine();
        })
        .catch(function () {
          setStatus("网络异常，请稍后重试", true);
          confirmBtn.disabled = false;
        });
    }
  });

  fetchMeUid()
    .then(function () {
      return loadMine();
    })
    .then(function () {
      startLoop();
    });
})();
