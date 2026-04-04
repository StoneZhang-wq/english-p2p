(function () {
  var el = document.getElementById("roomTimer");
  if (!el) return;

  var sec = 0;
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function tick() {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    el.textContent = pad(m) + ":" + pad(s);
    sec += 1;
  }

  tick();
  setInterval(tick, 1000);
})();
