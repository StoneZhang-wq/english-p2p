(function () {
  document.querySelectorAll("[data-appt-cancelable]").forEach(function (card) {
    var trigger = card.querySelector("[data-cancel-trigger]");
    var panel = card.querySelector("[data-cancel-panel]");
    var dismiss = card.querySelector("[data-cancel-dismiss]");
    var confirm = card.querySelector("[data-cancel-confirm]");

    if (!trigger || !panel || !dismiss || !confirm) return;

    function openPanel() {
      trigger.hidden = true;
      panel.hidden = false;
    }

    function closePanel() {
      panel.hidden = true;
      trigger.hidden = false;
    }

    trigger.addEventListener("click", openPanel);
    dismiss.addEventListener("click", closePanel);
    confirm.addEventListener("click", function () {
      card.remove();
    });
  });
})();
