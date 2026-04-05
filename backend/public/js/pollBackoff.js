/**
 * 短轮询间隔：失败时指数退避，成功则恢复基础间隔。
 */
function createPollBackoff(baseMs, maxMs) {
  var delay = baseMs;
  return {
    reset: function () {
      delay = baseMs;
    },
    next: function (ok) {
      if (ok) {
        delay = baseMs;
        return baseMs;
      }
      delay = Math.min(maxMs, Math.round(delay * 1.8));
      return delay;
    },
  };
}

window.createPollBackoff = createPollBackoff;
