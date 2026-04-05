/**
 * 预约页：拉取场次、短轮询名额、确认预约（POST /api/bookings）。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "booking") return;

  var themes = {
    interview: {
      title: "职场面试",
      desc: "模拟英文面试，讨论职业规划",
      cover: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80",
    },
    ielts: {
      title: "雅思口语 Part 2",
      desc: "随机抽取题库进行 2 分钟独白练习",
      cover: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80",
    },
    chat: {
      title: "日常闲聊",
      desc: "轻松的话题，分享生活趣事",
      cover: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80",
    },
  };

  var params = new URLSearchParams(window.location.search);
  var themeKey = params.get("theme") || "interview";
  var meta = themes[themeKey] || themes.interview;

  document.getElementById("themeTitle").textContent = meta.title;
  document.getElementById("themeDesc").textContent = meta.desc;
  var img = document.getElementById("themeCover");
  img.src = meta.cover;
  img.alt = meta.title;

  var grid = document.getElementById("slotGrid");
  var pollStatus = document.getElementById("bookingPollStatus");
  var btn = document.querySelector(".btn-primary");
  var levels = document.querySelectorAll(".level-card");

  var slots = [];
  var selectedSlotId = null;
  var selectedLevel = null;
  var backoff = window.createPollBackoff ? window.createPollBackoff(12000, 90000) : null;

  function setPollStatus(text, isErr) {
    if (!pollStatus) return;
    pollStatus.textContent = text || "";
    pollStatus.hidden = !text;
    pollStatus.classList.toggle("booking-poll-status--error", !!isErr);
  }

  function formatSlotMeta(booked, maxPairs) {
    var cap = maxPairs * 2;
    return booked + " / " + cap + " 人已约";
  }

  function renderSlots() {
    if (!grid) return;
    grid.innerHTML = "";
    slots.forEach(function (s) {
      var full = s.spotsLeft <= 0;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "slot-card" + (selectedSlotId === s.id ? " selected" : "");
      b.disabled = full;
      b.dataset.timeslotId = String(s.id);
      var st = new Date(String(s.startTime).replace(" ", "T"));
      function p2(n) {
        return n < 10 ? "0" + n : String(n);
      }
      var timeStr =
        st.getMonth() +
        1 +
        "/" +
        st.getDate() +
        " " +
        p2(st.getHours()) +
        ":" +
        p2(st.getMinutes());
      b.innerHTML =
        '<div class="time">' +
        timeStr +
        '</div><div class="meta">' +
        (full ? "已满" : formatSlotMeta(s.bookedCount, s.maxPairs)) +
        "</div>";
      if (!full) {
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
    if (btn) btn.disabled = !(selectedSlotId && selectedLevel);
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
      loadSlots().then(function (ok) {
        var wait = backoff ? backoff.next(ok) : 12000;
        setTimeout(tick, wait);
      });
    }
    setTimeout(tick, 12000);
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
            window.location.href = "appointments.html";
            return;
          }
          if (x.status === 401) {
            alert("请先登录");
            window.location.href = "login.html?next=" + encodeURIComponent(window.location.pathname + window.location.search);
            return;
          }
          alert(x.j.message || "预约失败");
        })
        .catch(function () {
          alert("网络错误");
        })
        .finally(function () {
          updateBtn();
          if (btn) btn.disabled = !(selectedSlotId && selectedLevel);
        });
    });
  }

  loadSlots().then(function () {
    startPollingLoop();
  });
})();
