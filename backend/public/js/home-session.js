/**
 * 首页：拉取 /api/auth/me，更新信用分与登录/退出入口。
 */
(function () {
  if (document.body.getAttribute("data-page") !== "home") return;

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  var bar = document.getElementById("sessionBar");
  var creditEl = document.getElementById("creditScore");

  fetch("/api/auth/me", { credentials: "include" })
    .then(function (r) {
      return r.json();
    })
    .then(function (j) {
      if (!j || j.code !== 0 || !j.data) return;
      var u = j.data.user;
      if (u && creditEl) {
        creditEl.textContent = String(u.creditScore != null ? u.creditScore : "—");
      }
      if (!bar) return;
      if (u) {
        bar.innerHTML =
          '<span class="session-nick">' +
          esc(u.nickname || "") +
          '</span> <button type="button" class="session-logout" id="logoutBtn">退出</button>';
        var btn = document.getElementById("logoutBtn");
        if (btn) {
          btn.addEventListener("click", function () {
            fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(function () {
              window.location.reload();
            });
          });
        }
      } else {
        bar.innerHTML = '<a href="login.html">登录</a> · <a href="register.html">注册</a>';
      }
    })
    .catch(function () {});
})();
