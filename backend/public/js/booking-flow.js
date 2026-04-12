/**
 * 预约页：拉取场次、短轮询、确认预约；检测本主题有效预约后显示预习入口；底部固定工具栏。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "booking") return;

  var params = new URLSearchParams(window.location.search);
  var themeId = Number(params.get("theme_id"));
  if (!themeId || Number.isNaN(themeId)) {
    window.location.replace("index.html");
    return;
  }

  /** 由 /api/themes/by-id 填充 */
  var meta = {
    title: "",
    desc: "",
    cover: "",
    badge: "本周主题",
    scene: "",
    roles: [],
    previewMarkdown: "",
    isActive: true,
  };

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function fillSceneAndRoles() {
    var badgeEl = document.getElementById("themeBadge");
    if (badgeEl) badgeEl.textContent = meta.badge || "本周主题";
    document.getElementById("themeTitle").textContent = meta.title;
    document.getElementById("themeDesc").textContent = meta.desc;
    var img = document.getElementById("themeCover");
    img.src = meta.cover;
    img.alt = meta.title;
    var quote = document.getElementById("sceneQuote");
    if (quote) quote.textContent = meta.scene || "";
    var grid = document.getElementById("roleGrid");
    if (grid && meta.roles && meta.roles.length) {
      grid.innerHTML = meta.roles
        .map(function (r) {
          return (
            '<article class="role-card">' +
            '<span class="role-card__label">' +
            escHtml(r.label) +
            "</span>" +
            '<h3 class="role-card__name">' +
            escHtml(r.name) +
            "</h3>" +
            '<p class="role-card__desc">' +
            escHtml(r.desc) +
            "</p></article>"
          );
        })
        .join("");
    }
  }

  var grid = document.getElementById("slotGrid");
  var pollStatus = document.getElementById("bookingPollStatus");
  var btn = document.getElementById("btnConfirmBook");
  var btnPreview = document.getElementById("btnPreviewMaterials");
  var previewRoot = document.getElementById("previewMaterialsRoot");
  var previewBody = document.getElementById("previewMaterialsBody");
  var btnDownloadMd = document.getElementById("btnDownloadPreviewMd");
  var toastEl = document.getElementById("bookingToast");
  var levels = document.querySelectorAll(".level-card");

  var slots = [];
  var selectedSlotId = null;
  var selectedLevel = null;
  var backoff = window.createPollBackoff ? window.createPollBackoff(12000, 90000) : null;
  var hasValidThemeBooking = false;
  var previewOpen = false;

  function parseDbTime(s) {
    if (!s) return null;
    var str = String(s).trim();
    // 无时区偏移的「上海场次」墙上时间（与后端 to_char / 规则一致），勿用浏览器本地时区误解析
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str) && !/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) {
      var iso = str.replace(" ", "T");
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ":00";
      var d0 = new Date(iso + "+08:00");
      return Number.isNaN(d0.getTime()) ? null : d0;
    }
    var d = new Date(str.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function minutesUntilStart(startIso) {
    var d = parseDbTime(startIso);
    if (!d) return Infinity;
    return (d.getTime() - Date.now()) / 60000;
  }

  function isSlotBookingClosed(startIso) {
    return minutesUntilStart(startIso) < 60;
  }

  function setPollStatus(text, isErr) {
    if (!pollStatus) return;
    pollStatus.textContent = text || "";
    pollStatus.hidden = !text;
    pollStatus.classList.toggle("booking-poll-status--error", !!isErr);
  }

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    setTimeout(function () {
      toastEl.hidden = true;
    }, 3200);
  }

  function formatSlotMeta(booked, maxPairs) {
    var cap = maxPairs * 2;
    return "已约 " + booked + " / " + cap + " 人";
  }

  var SHANGHAI_TZ = "Asia/Shanghai";

  function formatSlotTime(startIso) {
    var st = parseDbTime(startIso);
    if (!st) return "—";
    function p2(n) {
      return n < 10 ? "0" + n : String(n);
    }
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI_TZ,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(st);
    var mo = "",
      da = "",
      hh = "",
      mm = "";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === "month") mo = p.value;
      if (p.type === "day") da = p.value;
      if (p.type === "hour") hh = p2(Number(p.value));
      if (p.type === "minute") mm = p2(Number(p.value));
    }
    return mo + "-" + da + " " + hh + ":" + mm;
  }

  function formatSlotWeekday(startIso) {
    var st = parseDbTime(startIso);
    if (!st) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: SHANGHAI_TZ,
      weekday: "long",
    }).format(st);
  }

  function renderSlots() {
    if (!grid) return;
    grid.innerHTML = "";
    slots.forEach(function (s) {
      var full = s.spotsLeft <= 0;
      var closedByTime = isSlotBookingClosed(s.startTime);
      var disabled = full || closedByTime;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "slot-card" + (selectedSlotId === s.id ? " selected" : "") + (closedByTime ? " slot-card--closed" : "");
      b.disabled = disabled;
      b.dataset.timeslotId = String(s.id);
      var dateTimeStr = formatSlotTime(s.startTime);
      var weekdayStr = formatSlotWeekday(s.startTime);
      var badge = closedByTime
        ? '<span class="slot-card__badge" aria-label="已截止预约">已截止</span>'
        : "";
      var subLine =
        !full && !closedByTime && s.bookedCount > 0
          ? '<div class="slot-card__sub">已有伙伴加入，欢迎继续预约</div>'
          : !full && !closedByTime
            ? '<div class="slot-card__sub slot-card__sub--muted">名额开放中</div>'
            : "";
      b.innerHTML =
        badge +
        '<div class="slot-card__datetime">' +
        '<div class="slot-card__date-line">' +
        dateTimeStr +
        '</div><div class="slot-card__weekday">' +
        weekdayStr +
        '</div></div><div class="slot-card__meta">' +
        (full ? "已满" : formatSlotMeta(s.bookedCount, s.maxPairs)) +
        "</div>" +
        subLine;
      if (!disabled) {
        b.addEventListener("click", function () {
          grid.querySelectorAll(".slot-card").forEach(function (x) {
            x.classList.remove("selected");
          });
          b.classList.add("selected");
          selectedSlotId = s.id;
          updateBtn();
        });
      }
      grid.appendChild(b);
    });
    if (slots.length === 0) {
      grid.innerHTML = '<p class="booking-empty">暂无可预约场次</p>';
    }
  }

  function updateBtn() {
    if (!btn) return;
    if (!selectedSlotId || !selectedLevel) {
      btn.disabled = true;
      return;
    }
    var sel = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].id === selectedSlotId) {
        sel = slots[i];
        break;
      }
    }
    if (!sel || isSlotBookingClosed(sel.startTime) || sel.spotsLeft <= 0) {
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
  }

  levels.forEach(function (el) {
    el.addEventListener("click", function () {
      levels.forEach(function (x) {
        x.classList.remove("selected");
      });
      el.classList.add("selected");
      selectedLevel = el.getAttribute("data-level");
      updateBtn();
    });
  });

  function hasActiveBookingForCurrentTheme(bookings) {
    var now = Date.now();
    if (!bookings || !bookings.length) return false;
    return bookings.some(function (b) {
      if (Number(b.themeId) !== themeId) return false;
      if (String(b.bookingStatus || "").toLowerCase() !== "confirmed") return false;
      var end = parseDbTime(b.endTime);
      if (end && end.getTime() < now) return false;
      if (String(b.slotStatus || "").toLowerCase() === "cancelled") return false;
      return true;
    });
  }

  function syncPreviewChrome(bookings) {
    hasValidThemeBooking = hasActiveBookingForCurrentTheme(bookings || []);
    if (btnPreview) {
      btnPreview.hidden = !hasValidThemeBooking;
    }
    if (!hasValidThemeBooking) {
      previewOpen = false;
      if (previewRoot) previewRoot.hidden = true;
    } else if (previewBody) {
      previewBody.textContent = meta.previewMarkdown || "";
    }
  }

  function fetchMineForPreview() {
    return fetch("/api/bookings/mine", { credentials: "include" })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, status: r.status, j: j };
        });
      })
      .then(function (x) {
        if (x.status === 401 || !x.ok || x.j.code !== 0) {
          syncPreviewChrome([]);
          return;
        }
        syncPreviewChrome(x.j.data.bookings || []);
      })
      .catch(function () {
        syncPreviewChrome([]);
      });
  }

  function loadSlots() {
    return fetch("/api/timeslots?theme_id=" + encodeURIComponent(String(themeId)), { credentials: "include" })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (!x.ok || x.j.code !== 0) {
          throw new Error(x.j.message || "加载失败");
        }
        slots = x.j.data.timeslots || [];
        renderSlots();
        updateBtn();
        if (backoff) backoff.reset();
        setPollStatus("");
        return true;
      })
      .catch(function () {
        setPollStatus("网络不稳定，正在重连…", true);
        return false;
      });
  }

  function startPollingLoop() {
    function tick() {
      loadSlots().then(function () {
        fetchMineForPreview();
        var wait = backoff ? backoff.next(true) : 12000;
        setTimeout(tick, wait);
      });
    }
    setTimeout(tick, 12000);
  }

  if (btnPreview && previewRoot) {
    btnPreview.addEventListener("click", function () {
      if (btnPreview.hidden) return;
      previewOpen = !previewOpen;
      previewRoot.hidden = !previewOpen;
      if (previewOpen && previewBody) {
        previewBody.textContent = meta.previewMarkdown || "";
      }
    });
  }

  if (btnDownloadMd) {
    btnDownloadMd.addEventListener("click", function () {
      var url = "/api/preview-material/docx?theme_id=" + encodeURIComponent(String(themeId));
      fetch(url, { credentials: "include" })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.message) || "下载失败"); });
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = meta.title.replace(/\s+/g, "_") + "_预习资料.docx";
          a.click();
          URL.revokeObjectURL(a.href);
        })
        .catch(function () {
          showToast("下载失败，请先登录或稍后再试");
        });
    });
  }

  if (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      btn.disabled = true;
      fetch("/api/bookings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeslot_id: selectedSlotId, level: selectedLevel }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, j: j, status: r.status };
          });
        })
        .then(function (x) {
          if (x.j.code === 0) {
            showToast("预约成功！预习资料入口已解锁。");
            return fetchMineForPreview().then(function () {
              previewOpen = true;
              if (previewRoot) previewRoot.hidden = false;
              if (previewBody) previewBody.textContent = meta.previewMarkdown || "";
              return loadSlots();
            });
          }
          if (x.status === 401) {
            window.alert("请先登录");
            window.location.href =
              "login.html?next=" + encodeURIComponent(window.location.pathname + window.location.search);
            return;
          }
          window.alert(x.j.message || "预约失败");
        })
        .catch(function () {
          window.alert("网络错误");
        })
        .finally(function () {
          updateBtn();
        });
    });
  }

  if (params.get("booked") === "1") {
    showToast("预约成功！可查看预习资料。");
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete("booked");
      window.history.replaceState({}, "", u.pathname + u.search);
    } catch (_) {}
  }

  function boot() {
    fetch("/api/themes/by-id?id=" + encodeURIComponent(String(themeId)))
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (!x.ok || x.j.code !== 0 || !x.j.data || !x.j.data.theme) {
          window.alert(x.j && x.j.message ? x.j.message : "主题加载失败");
          window.location.replace("index.html");
          return;
        }
        var t = x.j.data.theme;
        meta.title = t.name || "";
        meta.desc = t.description || "";
        meta.cover = t.coverUrl || "";
        meta.scene = t.sceneText || "";
        meta.roles = Array.isArray(t.roles) ? t.roles : [];
        meta.previewMarkdown = t.previewMarkdown || "";
        meta.isActive = t.isActive !== false;
        fillSceneAndRoles();
        if (!meta.isActive) {
          setPollStatus("该主题所属练习周已结束，仅可查看历史信息。", true);
        }
        return loadSlots()
          .then(function () {
            return fetchMineForPreview();
          })
          .then(function () {
            startPollingLoop();
          });
      })
      .catch(function () {
        window.alert("网络错误");
        window.location.replace("index.html");
      });
  }

  boot();
})();
