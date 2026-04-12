/**
 * 练习任务区：TASKS 计数、常用句折叠、刷新状态、模拟加载另一组演示任务。
 */
(function () {
  var list = document.getElementById("practiceTaskList");
  var countEl = document.getElementById("practiceTasksCount");
  var refreshBtn = document.getElementById("practiceTasksRefresh");
  var simBtn = document.getElementById("practiceTasksSimulate");

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

  function updateTaskCount() {
    if (!list || !countEl) return;
    var total = list.querySelectorAll(".practice-task-card").length;
    var done = list.querySelectorAll(".practice-task-card.is-done").length;
    countEl.textContent = "(" + done + "/" + total + ")";
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
          '<li class="practice-task-card" data-task-id="' +
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
          "<span>USEFUL SENTENCES</span>" +
          '<span class="practice-task-hints-chev" aria-hidden="true">' +
          (isOpen ? "▲" : "▼") +
          "</span></button>" +
          '<div class="practice-task-hints-body">' +
          hints +
          "</div></div></li>"
        );
      })
      .join("");
    list.innerHTML = html;
    updateTaskCount();
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
    updateTaskCount();
  }

  if (list) {
    list.addEventListener("click", function (ev) {
      var toggle = ev.target.closest(".practice-task-hints-toggle");
      if (!toggle || !list.contains(toggle)) return;
      ev.preventDefault();
      var wrap = toggle.closest(".practice-task-hints");
      if (!wrap) return;
      var open = wrap.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      var chev = toggle.querySelector(".practice-task-hints-chev");
      if (chev) chev.textContent = open ? "▲" : "▼";
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

  window.__practiceTasksRefreshCount = updateTaskCount;
  updateTaskCount();
})();
