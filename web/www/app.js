(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const elements = {};
  for (const id of ["viewfinder", "focus", "message", "recording", "timer", "flash", "zoom", "photo", "video", "shutter", "switch", "gallery"]) {
    elements[id] = byId(id);
  }
  let cameraReady = false;
  let focusTimer;

  const send = command => {
    if (window.Native) window.Native.action(command);
  };
  for (const [id, command] of [
    ["message", "permission"], ["photo", "photo"], ["video", "video"], ["shutter", "shutter"],
    ["switch", "switch"], ["flash", "flash"], ["gallery", "gallery"]
  ]) {
    elements[id].addEventListener("click", () => send(command));
  }

  window.PureCamera = {
    render(state) {
      cameraReady = state.ready;
      elements.photo.classList.toggle("selected", state.mode === "photo");
      elements.video.classList.toggle("selected", state.mode === "video");
      elements.photo.setAttribute("aria-pressed", String(state.mode === "photo"));
      elements.video.setAttribute("aria-pressed", String(state.mode === "video"));
      elements.photo.disabled = !state.selectionEnabled;
      elements.video.disabled = !state.selectionEnabled;
      elements.shutter.disabled = !state.shutterEnabled;
      elements.shutter.classList.toggle("video", state.mode === "video");
      elements.shutter.classList.toggle("recording", state.recording);
      elements.shutter.setAttribute("aria-label", state.recording ? "Остановить запись видео" :
        state.mode === "photo" ? "Сделать снимок" : "Начать запись видео");
      elements.switch.disabled = !state.switchEnabled;
      elements.flash.disabled = !state.flashEnabled;
      elements.flash.textContent = state.flash;
      elements.zoom.textContent = state.zoom;
      elements.zoom.setAttribute("aria-label", "Приближение: " + state.zoom);
      elements.recording.hidden = !state.recording;
      elements.timer.textContent = state.duration;
      elements.message.hidden = !state.message;
      elements.message.textContent = state.message;
      elements.message.disabled = !state.messageEnabled;
      for (const edge of ["top", "bottom", "left", "right"]) {
        document.documentElement.style.setProperty("--" + edge, state.insets[edge] + "px");
      }
    }
  };

  let startPoint = null;
  let lastDistance = 0;
  let pinching = false;
  const distance = touches => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

  elements.viewfinder.addEventListener("touchstart", event => {
    if (!cameraReady || event.target.closest("button")) return;
    if (event.touches.length === 1) {
      startPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      pinching = false;
    } else if (event.touches.length === 2) {
      pinching = true;
      lastDistance = distance(event.touches);
    }
  }, { passive: true });

  elements.viewfinder.addEventListener("touchmove", event => {
    if (!cameraReady || !startPoint) return;
    if (event.touches.length === 2) {
      const next = distance(event.touches);
      if (lastDistance > 0 && window.Native) window.Native.zoom(Math.max(.5, Math.min(2, next / lastDistance)));
      lastDistance = next;
      pinching = true;
    }
  }, { passive: true });

  elements.viewfinder.addEventListener("touchend", event => {
    if (!startPoint || event.touches.length !== 0) return;
    const end = event.changedTouches[0];
    const moved = Math.hypot(end.clientX - startPoint.x, end.clientY - startPoint.y);
    if (!pinching && moved < 15 && cameraReady && window.Native) {
      window.Native.focus(end.clientX / window.innerWidth, end.clientY / window.innerHeight);
      elements.focus.style.left = end.clientX + "px";
      elements.focus.style.top = end.clientY + "px";
      elements.focus.classList.remove("visible");
      void elements.focus.offsetWidth;
      elements.focus.classList.add("visible");
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => elements.focus.classList.remove("visible"), 1000);
    }
    startPoint = null;
    lastDistance = 0;
  }, { passive: true });

  elements.viewfinder.addEventListener("touchcancel", () => { startPoint = null; lastDistance = 0; });
})();
