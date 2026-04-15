/**
 * 房间内角色展示与「互换」：须双方均点击互换后，两端同时交换角色与占位说明文案。
 * 信令走 /ws/room（与 CLAIM 共用连接，见 room-tasks.js 的 __roomSendRoleSwapIntent）。
 */
(function () {
  var myRoleName = "收银员";
  var peerRoleName = "客户";
  var roleBriefByName = {};
  var themeRoles = [];

  var myWantsSwap = false;
  var peerWantsSwap = false;

  var elMyName = document.getElementById("roleMyName");
  var elPeerName = document.getElementById("rolePeerName");
  var elBrief = document.getElementById("roleMyBrief");
  var elHint = document.getElementById("roleSwapHint");
  var btnSwap = document.getElementById("btnSwap");

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

  function renderBrief() {
    if (!elBrief) return;
    var text = roleBriefByName[myRoleName];
    elBrief.textContent =
      text || "【占位】请根据当前扮演角色，结合场景完成口语练习。（后续由系统生成更贴合主题的说明）";
  }

  function renderNames() {
    if (elMyName) elMyName.textContent = myRoleName;
    if (elPeerName) elPeerName.textContent = peerRoleName;
    renderBrief();
  }

  function updateHint() {
    if (!elHint) return;
    if (myWantsSwap && peerWantsSwap) {
      elHint.hidden = true;
      elHint.textContent = "";
      return;
    }
    if (myWantsSwap) {
      elHint.hidden = false;
      elHint.textContent = "已请求互换，等待对方也点击「互换」…";
      return;
    }
    if (peerWantsSwap) {
      elHint.hidden = false;
      elHint.textContent = "对方已请求互换，你也可以点击「互换」以确认交换角色。";
      return;
    }
    elHint.hidden = true;
    elHint.textContent = "";
  }

  function tryExecuteSwap() {
    if (!myWantsSwap || !peerWantsSwap) return;
    var t = myRoleName;
    myRoleName = peerRoleName;
    peerRoleName = t;
    myWantsSwap = false;
    peerWantsSwap = false;
    renderNames();
    if (typeof window.__roomOnRoleChanged === "function") {
      window.__roomOnRoleChanged(myRoleName, peerRoleName);
    }
    if (typeof window.__roomSendRoleSwapIntent === "function") {
      window.__roomSendRoleSwapIntent(false);
    }
    updateHint();
    showToast("双方已确认，角色已互换", false);
  }

  window.__handleRoleSwapPeerIntent = function (msg) {
    var wants = !!(msg && msg.wants);
    peerWantsSwap = wants;
    updateHint();
    tryExecuteSwap();
  };

  function sendMyIntent(wants) {
    if (typeof window.__roomSendRoleSwapIntent !== "function") return false;
    return window.__roomSendRoleSwapIntent(wants);
  }

  if (btnSwap) {
    btnSwap.addEventListener("click", function () {
      if (myWantsSwap) {
        myWantsSwap = false;
        sendMyIntent(false);
        updateHint();
        showToast("已取消互换请求", false);
        return;
      }
      if (!sendMyIntent(true)) {
        showToast("信令未连接，请稍候或刷新页面", true);
        return;
      }
      myWantsSwap = true;
      updateHint();
      tryExecuteSwap();
    });
  }

  function setRolesFromTheme(roles) {
    if (!Array.isArray(roles) || roles.length < 2) return;
    themeRoles = roles.slice(0, 2);
    var aName = String(themeRoles[0].name || "").trim();
    var bName = String(themeRoles[1].name || "").trim();
    if (aName && bName) {
      // 默认：本端先取第一个角色；如需更严格分配可在后端加字段。
      myRoleName = aName;
      peerRoleName = bName;
    }
    roleBriefByName = {};
    themeRoles.forEach(function (r) {
      var n = String(r.name || "").trim();
      var d = String(r.desc || "").trim();
      if (n && d) roleBriefByName[n] = d;
    });
    renderNames();
    updateHint();
    if (typeof window.__roomOnRoleChanged === "function") {
      window.__roomOnRoleChanged(myRoleName, peerRoleName);
    }
  }

  window.__roomSetThemeRoles = function (roles) {
    setRolesFromTheme(roles);
  };

  window.__roomGetMyRoleName = function () {
    return myRoleName;
  };

  renderNames();
  updateHint();
})();
