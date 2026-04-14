/**
 * 练习任务区：TASKS 完成计数、任务分页（每次只展示一条）、常用句折叠、刷新、模拟任务集。
 */
(function () {
  var list = document.getElementById("practiceTaskList");
  var countEl = document.getElementById("practiceTasksCount");
  var pagerLabel = document.getElementById("practiceTaskPagerLabel");
  var btnPrev = document.getElementById("practiceTaskPrev");
  var btnNext = document.getElementById("practiceTaskNext");
  var refreshBtn = document.getElementById("practiceTasksRefresh");
  var simBtn = document.getElementById("practiceTasksSimulate");

  var currentTaskIndex = 0;

  function showToast(msg, isError) {
    var el = document.getElementById("roomToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("room-toast--error", !!isError);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  function getTaskCards() {
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll(".practice-task-card"));
  }

  function updateTaskCount() {
    if (!list || !countEl) return;
    var cards = getTaskCards();
    var total = cards.length;
    var done = cards.filter(function (c) {
      return c.classList.contains("is-done");
    }).length;
    countEl.textContent = done + " / " + total;
  }

  function syncTaskPager() {
    var cards = getTaskCards();
    var n = cards.length;
    if (n === 0) {
      if (pagerLabel) pagerLabel.textContent = "0 / 0";
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }
    if (currentTaskIndex >= n) currentTaskIndex = n - 1;
    if (currentTaskIndex < 0) currentTaskIndex = 0;
    cards.forEach(function (card, i) {
      var on = i === currentTaskIndex;
      card.classList.toggle("is-task-active", on);
    });
    if (pagerLabel) pagerLabel.textContent = currentTaskIndex + 1 + " / " + n;
    if (btnPrev) btnPrev.disabled = currentTaskIndex <= 0;
    if (btnNext) btnNext.disabled = currentTaskIndex >= n - 1;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  var ALT_SET = [
    {
      id: "s1",
      title: "介绍自己的一项业余爱好",
      hints: [
        "I usually spend my weekends hiking near the city.",
        "I've been learning guitar for about six months.",
        "It's nothing serious — just a way to unwind after work.",
      ],
    },
    {
      id: "s2",
      title: "描述一次让你印象深刻的旅行",
      hints: [
        "The food there was amazing, especially the street snacks.",
        "We got a bit lost, but locals were really helpful.",
        "I'd love to go back when the weather is cooler.",
      ],
    },
    {
      id: "s3",
      title: "邀请对方周末一起活动",
      hints: [
        "Are you free this Saturday afternoon?",
        "A few of us are going to try that new café — want to join?",
        "No pressure — just let me know if it works for you.",
      ],
    },
    {
      id: "s4",
      title: "【占位】确认对方是否方便继续聊几分钟",
      hints: [
        "Do you have a minute to keep chatting?",
        "I can wrap up quickly if you need to go.",
        "Thanks for being patient with my English.",
      ],
    },
    {
      id: "s5",
      title: "【占位】请对方给一个简单建议或反馈",
      hints: [
        "What would you do if you were in my shoes?",
        "I'd love to hear your honest feedback.",
        "Is there anything I should phrase differently?",
      ],
    },
    {
      id: "s6",
      title: "【占位】致谢并自然结束对话",
      hints: [
        "It was really nice talking with you.",
        "Hope we can practice again sometime.",
        "Take care, and have a lovely evening!",
      ],
    },
  ];

  function renderFromSet(items, openIndex) {
    if (!list) return;
    var html = items
      .map(function (t, i) {
        var isOpen = i === openIndex;
        var hints = t.hints
          .map(function (h) {
            return '<p class="practice-hint-line">' + esc(h) + "</p>";
          })
          .join("");
        return (
          '<li class="practice-task-card' +
          (i === 0 ? " is-task-active" : "") +
          '" data-task-id="' +
          esc(t.id) +
          '">' +
          '<div class="practice-task-row">' +
          '<h3 class="practice-task-title">' +
          esc(t.title) +
          "</h3>" +
          '<button type="button" class="practice-task-claim task-complete-btn">CLAIM</button>' +
          "</div>" +
          '<div class="practice-task-hints' +
          (isOpen ? " is-open" : "") +
          '">' +
          '<button type="button" class="practice-task-hints-toggle" aria-expanded="' +
          (isOpen ? "true" : "false") +
          '">' +
          "<span>HINTS · USEFUL SENTENCES</span>" +
          '<span class="practice-task-hints-chev" aria-hidden="true">' +
          (isOpen ? "\u25b2" : "\u25bc") +
          "</span></button>" +
          '<div class="practice-task-hints-body">' +
          hints +
          "</div></div></li>"
        );
      })
      .join("");
    list.innerHTML = html;
    currentTaskIndex = 0;
    updateTaskCount();
    syncTaskPager();
  }

  function resetAllTaskLocks() {
    if (!list) return;
    list.querySelectorAll(".practice-task-card").forEach(function (card) {
      card.classList.remove("is-done");
      var btn = card.querySelector(".practice-task-claim");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "CLAIM";
        btn.classList.remove("is-waiting", "is-done");
      }
    });
    currentTaskIndex = 0;
    updateTaskCount();
    syncTaskPager();
  }

  if (list) {
    list.addEventListener("click", function (ev) {
      var toggle = ev.target.closest(".practice-task-hints-toggle");
      if (!toggle || !list.contains(toggle)) return;
      var card = toggle.closest(".practice-task-card");
      if (!card || !card.classList.contains("is-task-active")) return;
      ev.preventDefault();
      var wrap = toggle.closest(".practice-task-hints");
      if (!wrap) return;
      var open = wrap.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      var chev = toggle.querySelector(".practice-task-hints-chev");
      if (chev) chev.textContent = open ? "\u25b2" : "\u25bc";
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", function () {
      if (currentTaskIndex <= 0) return;
      currentTaskIndex -= 1;
      syncTaskPager();
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", function () {
      var n = getTaskCards().length;
      if (currentTaskIndex >= n - 1) return;
      currentTaskIndex += 1;
      syncTaskPager();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      resetAllTaskLocks();
      showToast("已重置任务认领状态", false);
    });
  }

  if (simBtn) {
    simBtn.addEventListener("click", function () {
      renderFromSet(ALT_SET, 0);
      showToast("已加载演示用另一组任务", false);
    });
  }

  window.__practiceTasksRefreshCount = function () {
    updateTaskCount();
    syncTaskPager();
  };

  /**
   * 由 room-agora 在 rtc-token-booking 返回 roomTasks 后调用；每项含 id、title（中文）、hints（英文数组）。
   */
  window.__applyRoomTasksFromApi = function (tasks) {
    if (!list || !Array.isArray(tasks) || tasks.length === 0) return;
    var DESIRED_TOTAL = 6;
    var normalized = tasks
      .map(function (t) {
        return {
          id: String(t.id || ""),
          title: String(t.title || ""),
          hints: Array.isArray(t.hints) ? t.hints.map(String).filter(Boolean) : [],
        };
      })
      .filter(function (t) {
        return t.id && t.title && t.hints.length >= 2;
      });
    if (!normalized.length) return;
    // 产品规则：房间 TASKS 始终展示 6 条；接口不足时用占位任务补齐。
    var next = normalized.slice(0, DESIRED_TOTAL);
    if (next.length < DESIRED_TOTAL) {
      var used = {};
      next.forEach(function (t) {
        used[t.id] = true;
      });
      ALT_SET.forEach(function (t) {
        if (next.length >= DESIRED_TOTAL) return;
        var id = String(t.id || "");
        if (!id || used[id]) id = "pad_" + (next.length + 1);
        next.push({
          id: id,
          title: String(t.title || "【占位】补齐任务"),
          hints: Array.isArray(t.hints) ? t.hints.map(String).filter(Boolean) : [],
        });
        used[id] = true;
      });
    }
    while (next.length < DESIRED_TOTAL) {
      next.push({
        id: "pad_" + (next.length + 1),
        title: "【占位】补齐任务",
        hints: ["Could you say that again, please?", "Let me think for a second."],
      });
    }
    renderFromSet(next, 0);
    showToast("已加载本主题的练习任务", false);
  };

  updateTaskCount();
  syncTaskPager();
})();
