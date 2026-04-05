/**
 * 声网 Agora RTC Web SDK 4.x：Token 入会、麦克风发布、订阅远端音频。
 * 调试：同一频道需不同 uid，如 room.html?channel=demo-room&uid=10001 与 uid=10002
 */
(function () {
  var state = {
    client: null,
    joined: false,
    localAudio: null,
    localVideo: null,
    micOn: true,
    camOn: false,
  };

  function apiBase() {
    var raw = document.body.getAttribute("data-api-base");
    if (raw === null || raw === "") return window.location.origin;
    return String(raw).replace(/\/$/, "");
  }

  function showRoomToast(msg, isError) {
    var el = document.getElementById("roomToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle("room-toast--error", !!isError);
    clearTimeout(showRoomToast._t);
    showRoomToast._t = setTimeout(function () {
      el.hidden = true;
    }, 5000);
  }

  function setPartnerLabel(text) {
    var el = document.querySelector("#tilePartner .label");
    if (el) el.textContent = text;
  }

  function formatAgoraError(e) {
    var msg = (e && e.message) || (e ? String(e) : "未知错误");
    if (e && e.code !== undefined && e.code !== "") {
      msg += " (code:" + e.code + ")";
    }
    return msg;
  }

  /** unilbs 返回 no active status：多为控制台项目/计费/证书与 App 不匹配，非本页 CSS 或区域重试可根治 */
  function joinFailureHint(e) {
    var text = formatAgoraError(e);
    var blob = text + (e && e.data ? JSON.stringify(e.data) : "");
    if (/no active status|CAN_NOT_GET_GATEWAY/i.test(blob)) {
      text +=
        " — 声网调度已连通，但判定当前 App 不可用。请到声网控制台检查：① 该项目已启用且开通「视频通话/RTC」；② 账户无欠费、试用未过期；③ Railway 里 AGORA_APP_ID 与 AGORA_APP_CERTIFICATE 为同一项目且证书未重置；④ 国际区与国内区控制台勿混用。仍失败请带 App ID 与上述日志联系声网支持。";
    }
    return text;
  }

  async function fetchRtcToken(channelName, uid) {
    var res = await fetch(apiBase() + "/api/agora/rtc-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName: channelName, uid: uid }),
    });
    var json = await res.json();
    if (!res.ok || json.code !== 0) {
      var err = new Error(json.message || "获取 Token 失败");
      err.detail = json;
      throw err;
    }
    return json.data;
  }

  async function run() {
    if (typeof AgoraRTC === "undefined") {
      showRoomToast("声网 SDK 未加载，请检查网络或脚本地址", true);
      return;
    }

    if (typeof AgoraRTC.enableLogUpload === "function") {
      try {
        AgoraRTC.enableLogUpload();
      } catch (e) {
        console.warn("enableLogUpload", e);
      }
    }
    if (typeof AgoraRTC.setLogLevel === "function") {
      AgoraRTC.setLogLevel(1);
    }

    var params = new URLSearchParams(window.location.search);
    var channelName = params.get("channel") || "demo_eng_local";
    var uid = Number(params.get("uid") || "10001");
    var areaToken = params.get("agoraArea");

    setPartnerLabel("搭档（连接中…）");

    var cred;
    try {
      cred = await fetchRtcToken(channelName, uid);
    } catch (e) {
      console.error(e);
      showRoomToast(e.message || "无法加入频道", true);
      setPartnerLabel("搭档（未连接）");
      return;
    }

    var client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    client.on("user-published", async function (user, mediaType) {
      try {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio" && user.audioTrack) {
          user.audioTrack.play();
        }
        if (mediaType === "video" && user.videoTrack) {
          var remoteSlot = document.getElementById("remoteVideoSlot");
          var partnerTile = document.getElementById("tilePartner");
          if (remoteSlot) user.videoTrack.play(remoteSlot, { fit: "cover" });
          if (partnerTile) partnerTile.classList.add("video-tile--remote-live");
        }
        setPartnerLabel("搭档（已连接）");
      } catch (e) {
        console.error("subscribe", e);
      }
    });

    client.on("user-unpublished", function (user, mediaType) {
      if (mediaType === "video") {
        var partnerTile = document.getElementById("tilePartner");
        if (partnerTile) partnerTile.classList.remove("video-tile--remote-live");
        setPartnerLabel("搭档（已连接）");
      }
      if (mediaType === "audio") {
        setPartnerLabel("搭档（无麦克风）");
      }
    });

    client.on("user-left", function () {
      var partnerTile = document.getElementById("tilePartner");
      if (partnerTile) partnerTile.classList.remove("video-tile--remote-live");
      setPartnerLabel("搭档（已离开）");
    });

    try {
      await (async function tryJoinChannel() {
        var A = AgoraRTC.AREAS;
        var setArea = typeof AgoraRTC.setArea === "function" ? AgoraRTC.setArea.bind(AgoraRTC) : null;
        var areaOrders = [];

        if (areaToken && A && setArea) {
          var areaKey = String(areaToken).toUpperCase().replace(/[^A-Z_]/g, "");
          if (A[areaKey] !== undefined) {
            areaOrders.push([A[areaKey]]);
          }
        }

        /* 未指定 agoraArea 时：按两种顺序尝试 GLOBAL+CHINA，缓解 CAN_NOT_GET_GATEWAY_SERVER / no active status */
        if (areaOrders.length === 0 && A && setArea && A.GLOBAL != null && A.CHINA != null) {
          areaOrders.push([A.GLOBAL, A.CHINA]);
          areaOrders.push([A.CHINA, A.GLOBAL]);
        }

        if (areaOrders.length === 0) {
          await client.join(cred.appId, cred.channelName, cred.token, cred.uid);
          return;
        }

        var lastErr;
        for (var i = 0; i < areaOrders.length; i++) {
          try {
            setArea(areaOrders[i]);
            await client.join(cred.appId, cred.channelName, cred.token, cred.uid);
            return;
          } catch (err) {
            lastErr = err;
            console.warn("Agora join attempt " + (i + 1) + "/" + areaOrders.length, err);
          }
        }
        throw lastErr;
      })();
    } catch (e) {
      console.error(e);
      showRoomToast("加入频道失败：" + joinFailureHint(e), true);
      setPartnerLabel("搭档（未连接）");
      return;
    }

    state.client = client;
    state.joined = true;

    try {
      state.localAudio = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([state.localAudio]);
    } catch (e) {
      console.error(e);
      showRoomToast("麦克风不可用：" + (e.message || e), true);
    }

    showRoomToast("已加入频道，等待语伴…", false);
  }

  async function leaveChannel() {
    try {
      if (state.localAudio) {
        state.localAudio.stop();
        state.localAudio.close();
        state.localAudio = null;
      }
      if (state.localVideo) {
        state.localVideo.stop();
        state.localVideo.close();
        state.localVideo = null;
      }
      var selfTile = document.getElementById("tileSelf");
      if (selfTile) selfTile.classList.remove("video-tile--local-live");
      var partnerTile = document.getElementById("tilePartner");
      if (partnerTile) partnerTile.classList.remove("video-tile--remote-live");
      state.joined = false;
      if (state.client) {
        await state.client.leave();
        state.client = null;
      }
    } catch (e) {
      console.warn("leaveChannel", e);
    }
  }

  function wireControls() {
    var btnMic = document.getElementById("btnMic");
    if (btnMic) {
      btnMic.addEventListener("click", function () {
        state.micOn = !state.micOn;
        btnMic.style.opacity = state.micOn ? "1" : "0.45";
        if (state.localAudio && typeof state.localAudio.setEnabled === "function") {
          state.localAudio.setEnabled(state.micOn);
        }
      });
    }

    var btnCam = document.getElementById("btnCam");
    if (btnCam) {
      btnCam.addEventListener("click", async function () {
        if (!state.joined || !state.client) {
          showRoomToast("正在加入频道，请稍候再开摄像头", true);
          return;
        }
        try {
          if (!state.camOn) {
            state.localVideo = await AgoraRTC.createCameraVideoTrack();
            await state.client.publish([state.localVideo]);
            var localSlot = document.getElementById("localVideoSlot");
            var selfTile = document.getElementById("tileSelf");
            if (localSlot) state.localVideo.play(localSlot, { fit: "cover", mirror: true });
            if (selfTile) selfTile.classList.add("video-tile--local-live");
            state.camOn = true;
            btnCam.style.opacity = "1";
            showRoomToast("已开启摄像头", false);
          } else {
            if (state.localVideo) {
              await state.client.unpublish([state.localVideo]);
              state.localVideo.stop();
              state.localVideo.close();
              state.localVideo = null;
            }
            var selfTile = document.getElementById("tileSelf");
            if (selfTile) selfTile.classList.remove("video-tile--local-live");
            state.camOn = false;
            btnCam.style.opacity = "0.6";
            showRoomToast("已关闭摄像头", false);
          }
        } catch (e) {
          console.error(e);
          if (state.localVideo && !state.camOn) {
            try {
              state.localVideo.stop();
              state.localVideo.close();
            } catch (_) {}
            state.localVideo = null;
          }
          showRoomToast("摄像头：" + (e.message || e), true);
        }
      });
      btnCam.style.opacity = "0.6";
    }

    var btnEnd = document.getElementById("btnEnd");
    if (btnEnd) {
      btnEnd.addEventListener("click", async function () {
        if (!confirm("确定结束本次练习？")) return;
        await leaveChannel();
        window.location.href = "appointments.html";
      });
    }
  }

  wireControls();
  run();
})();
