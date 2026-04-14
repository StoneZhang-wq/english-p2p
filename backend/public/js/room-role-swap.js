/**
 * 房间内角色展示与「互换」：须双方均点击互换后，两端同时交换角色与占位说明文案。
 * 信令走 /ws/room（与 CLAIM 共用连接，见 room-tasks.js 的 __roomSendRoleSwapIntent）。
 */
(function () {
  var myRoleName = "收银员";
  var peerRoleName = "客户";

  /** 占位：后续可由主题 / AI 生成替换 */
  var ROLE_BRIEF = {
    收银员:
      "【占位】你在柜台内侧负责接待这位客户。当前背景：网点营业中，对方需要办理业务。你的工作是按流程接待、询问与确认需求，并全程尽量使用英语沟通。",
    客户:
      "【占位】你作为客户来到柜台办理业务。当前背景：网点营业中，你需要向工作人员说明诉求并配合必要问询。你的工作是表达清楚需求、回答问题，并尽量使用英语完成沟通。",
  };

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
    var text = ROLE_BRIEF[myRoleName];
    elBrief.textContent = text || "【占位】请根据当前扮演角色，结合场景完成口语练习。（后续由系统生成更贴合主题的说明）";
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

  renderNames();
  updateHint();
})();
