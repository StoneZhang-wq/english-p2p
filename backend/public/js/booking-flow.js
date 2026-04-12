/**
 * 预约页：拉取场次、短轮询、确认预约；检测本主题有效预约后显示预习入口；底部固定工具栏。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "booking") return;

  var themes = {
    interview: {
      title: "职场面试",
      desc: "模拟英文面试，讨论职业规划",
      cover: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80",
      badge: "DAILY TOPIC",
      scene:
        "你来到一家知名的跨国科技公司参加面试。会议室灯光明亮，面试官坐在桌子对面，已经读过你的简历，正等待你用英语完成自我介绍并阐述你与岗位的匹配点。",
      roles: [
        { label: "ROLE 1", name: "面试官", desc: "负责评估你的专业能力、逻辑表达与英语流利度。" },
        { label: "ROLE 2", name: "求职者", desc: "有备而来，展示经历并回答对方提问，争取留下好印象。" },
      ],
    },
    ielts: {
      title: "雅思口语 Part 2",
      desc: "随机抽取题库进行 2 分钟独白练习",
      cover: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80",
      badge: "DAILY TOPIC",
      scene:
        "考官给出一张话题卡，你有一分钟准备时间，随后需要连续陈述约两分钟。对方会认真聆听，并在最后追问一两个相关问题。",
      roles: [
        { label: "ROLE 1", name: "考生", desc: "根据话题卡组织独白，注意时态与衔接词。" },
        { label: "ROLE 2", name: "考官", desc: "提示开始/结束，并在 Part 2 后提出简短追问。" },
      ],
    },
    chat: {
      title: "日常闲聊",
      desc: "轻松的话题，分享生活趣事",
      cover: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",
      badge: "DAILY TOPIC",
      scene:
        "咖啡馆靠窗的座位，你和刚认识的语伴决定用英语随便聊聊近况、旅行或周末计划，氛围轻松自然。",
      roles: [
        { label: "ROLE 1", name: "发起聊天的人", desc: "主动抛话题、接话并维持对话节奏。" },
        { label: "ROLE 2", name: "倾听与回应", desc: "认真回应、追问细节，让对话延续下去。" },
      ],
    },
  };

  /** 与 `backend/data/previewMaterials.js` 保持同步（页内预览用；下载走 /api/preview-material/docx） */
  var PREVIEW_MARKDOWN = {
    interview:
      "## Key vocabulary\n- **initiate** — 发起；开始\n- **candidate** — 候选人\n- **qualification** — 资质\n\n## Useful lines\n- I would like to elaborate on my experience in…\n- Could you tell me more about the team structure?\n",
    ielts:
      "## Part 2 tips\n- Use the **one-minute** prep to jot down **keywords**.\n- Structure: introduction → main points → conclusion.\n\n## Sample stems\n- Describe a place you visited…\n- Talk about an important decision…\n",
    chat:
      "## Small talk\n- **How's your day going?**\n- **Any plans for the weekend?**\n\n## Light fillers\n- That's interesting!\n- I see what you mean.\n",
  };

  var params = new URLSearchParams(window.location.search);
  var themeKey = params.get("theme") || "interview";
  var meta = themes[themeKey] || themes.interview;

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function fillSceneAndRoles() {
    var badgeEl = document.getElementById("themeBadge");
    if (badgeEl) badgeEl.textContent = meta.badge || "DAILY TOPIC";
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

  fillSceneAndRoles();

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
    var mo = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TZ, month: "2-digit" }).format(st);
    var da = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TZ, day: "2-digit" }).format(st);
    var hh = new Intl.DateTimeFormat("en-US", {
      timeZone: SHANGHAI_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(st);
    var mm = new Intl.DateTimeFormat("en-US", { timeZone: SHANGHAI_TZ, minute: "2-digit" }).format(st);
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
    var title = meta.title;
    var now = Date.now();
    if (!bookings || !bookings.length) return false;
    return bookings.some(function (b) {
      if (b.themeName !== title) return false;
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
      previewBody.textContent = PREVIEW_MARKDOWN[themeKey] || PREVIEW_MARKDOWN.interview;
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
    return fetch("/api/timeslots?theme=" + encodeURIComponent(themeKey), { credentials: "include" })
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
        previewBody.textContent = PREVIEW_MARKDOWN[themeKey] || PREVIEW_MARKDOWN.interview;
      }
    });
  }

  if (btnDownloadMd) {
    btnDownloadMd.addEventListener("click", function () {
      var url = "/api/preview-material/docx?theme=" + encodeURIComponent(themeKey);
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
              if (previewBody) previewBody.textContent = PREVIEW_MARKDOWN[themeKey] || PREVIEW_MARKDOWN.interview;
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

  loadSlots()
    .then(function () {
      return fetchMineForPreview();
    })
    .then(function () {
      startPollingLoop();
    });
})();
