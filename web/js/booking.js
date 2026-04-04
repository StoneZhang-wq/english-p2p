(function () {
  var slots = document.querySelectorAll(".slot-card");
  var levels = document.querySelectorAll(".level-card");
  var btn = document.querySelector(".btn-primary");

  function updateBtn() {
    var s = document.querySelector(".slot-card.selected");
    var l = document.querySelector(".level-card.selected");
    if (btn) btn.disabled = !(s && l);
  }

  slots.forEach(function (el) {
    el.addEventListener("click", function () {
      slots.forEach(function (x) {
        x.classList.remove("selected");
      });
      el.classList.add("selected");
      updateBtn();
    });
  });

  levels.forEach(function (el) {
    el.addEventListener("click", function () {
      levels.forEach(function (x) {
        x.classList.remove("selected");
      });
      el.classList.add("selected");
      updateBtn();
    });
  });

  if (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      window.location.href = "appointments.html";
    });
  }

  updateBtn();
})();
