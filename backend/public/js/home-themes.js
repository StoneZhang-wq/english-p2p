/**
 * 首页：GET /api/themes 动态渲染本周三个主题卡片。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "home") return;

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  var root = document.getElementById("topicCardsRoot");
  if (!root) return;

  function render(data) {
    root.innerHTML = "";
    if (!data || !data.themes || data.themes.length === 0) {
      root.innerHTML =
        '<p class="booking-empty" style="margin:1rem 0">' + esc(data && data.notice ? data.notice : "暂无可用主题") + "</p>";
      return;
    }
    data.themes.forEach(function (t) {
      var a = document.createElement("a");
      a.className = "topic-card";
      a.href = "booking.html?theme_id=" + encodeURIComponent(String(t.id));
      var roles = (t.roles || [])
        .map(function (r) {
          return r.name || "";
        })
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
      var roleLine = roles ? esc(roles) + " · 2 角色可供扮演" : "2 角色可供扮演";
      a.innerHTML =
        '<div class="topic-card__media">' +
        '<span class="topic-pill" aria-hidden="true">本周</span>' +
        '<img class="cover" src="' +
        esc(t.coverUrl || "") +
        '" alt="" loading="lazy" />' +
        '<div class="topic-card__shade">' +
        '<h2 class="topic-card__overlay-title">' +
        esc(t.name) +
        "</h2>" +
        '<p class="topic-card__overlay-desc">' +
        esc(t.description || "") +
        "</p></div></div>" +
        '<div class="body"><div class="topic-card__roles" aria-hidden="true">' +
        '<span class="topic-card__role-ico">👤</span><span class="topic-card__role-ico">👤</span>' +
        '<span class="topic-card__roles-text">' +
        roleLine +
        '</span><span class="topic-card__chev" aria-hidden="true">›</span></div></div>';
      root.appendChild(a);
    });
  }

  fetch("/api/themes")
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (j && j.code === 0 && j.data) render(j.data);
    })
    .catch(function () {
      root.innerHTML = '<p class="booking-empty" style="margin:1rem 0">无法加载主题，请检查网络。</p>';
    });
})();
