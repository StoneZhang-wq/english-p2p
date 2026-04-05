/**
 * 声网 Agora RTC Web SDK 4.x：Token 入会、麦克风发布、订阅远端音频。
 * 调试：同一频道需不同 uid，如 room.html?channel=demo-room&uid=10001 与 uid=10002
 */
(function () {
  var state = {
    client: null,
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
    state.client = client;

    try {
      await client.join(cred.appId, cred.channelName, cred.token, cred.uid);
    } catch (e) {
      console.error(e);
      showRoomToast("加入频道失败：" + (e.message || e), true);
      setPartnerLabel("搭档（未连接）");
      return;
    }

    try {
      state.localAudio = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([state.localAudio]);
    } catch (e) {
      console.error(e);
      showRoomToast("麦克风不可用：" + (e.message || e), true);
    }

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
        if (!state.client) {
          showRoomToast("尚未加入频道", true);
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
