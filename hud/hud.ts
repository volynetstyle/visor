import type { HudState, HudRuntime } from "../contract/globals";
(() => {
  "use strict";

  // Performance contract: docs/PERFORMANCE.md. One on-demand frame, no camera data.
  const elementIds = [
    "viewfinder",
    "focus",
    "message",
    "recording",
    "timer",
    "flash",
    "zoom",
    "photo",
    "video",
    "shutter",
    "switch",
    "gallery",
  ] as const;
  type ButtonId = "message" | "flash" | "photo" | "video" | "shutter" | "switch" | "gallery";
  type HudElements = Record<(typeof elementIds)[number], HTMLElement> &
    Record<ButtonId, HTMLButtonElement>;
  const elements = {} as HudElements;
  for (const id of elementIds) {
    (elements as Record<string, HTMLElement>)[id] = document.getElementById(id)!;
  }
  const rootStyle = document.documentElement.style;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const previous: Record<string, string | boolean | number> = {};
  let latestState: HudState | null = null;
  let frame = 0;
  let cameraReady = false;
  let visible = !document.hidden;
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;
  let pendingZoom = 1;
  let pendingFocus: { x: number; y: number } | null = null;
  let focusAnimation: Animation | null = null;
  let gesture = false;
  let pinching = false;
  let startX = 0;
  let startY = 0;
  let lastDistance = 0;
  let runtime: HudRuntime;

  function schedule() {
    if (visible && !frame) frame = requestAnimationFrame(flush);
  }

  function applyState(state: HudState) {
    if (previous.mode !== state.mode) {
      const photo = state.mode === "photo";
      elements.photo.classList.toggle("selected", photo);
      elements.video.classList.toggle("selected", !photo);
      elements.photo.setAttribute("aria-pressed", String(photo));
      elements.video.setAttribute("aria-pressed", String(!photo));
      elements.shutter.classList.toggle("video", !photo);
    }
    if (previous.mode !== state.mode || previous.recording !== state.recording) {
      elements.shutter.setAttribute(
        "aria-label",
        state.recording
          ? "Остановить запись видео"
          : state.mode === "photo"
            ? "Сделать снимок"
            : "Начать запись видео",
      );
    }
    if (previous.selectionEnabled !== state.selectionEnabled) {
      elements.photo.disabled = !state.selectionEnabled;
      elements.video.disabled = !state.selectionEnabled;
    }
    if (previous.shutterEnabled !== state.shutterEnabled)
      elements.shutter.disabled = !state.shutterEnabled;
    if (previous.switchEnabled !== state.switchEnabled)
      elements.switch.disabled = !state.switchEnabled;
    if (previous.flashEnabled !== state.flashEnabled) elements.flash.disabled = !state.flashEnabled;
    if (previous.flash !== state.flash) elements.flash.textContent = state.flash;
    if (previous.zoom !== state.zoom) {
      elements.zoom.textContent = state.zoom;
      elements.zoom.setAttribute("aria-label", "Приближение: " + state.zoom);
    }
    if (previous.recording !== state.recording) {
      elements.shutter.classList.toggle("recording", state.recording);
      elements.recording.hidden = !state.recording;
    }
    if (previous.duration !== state.duration) elements.timer.textContent = state.duration;
    if (previous.message !== state.message) {
      elements.message.hidden = !state.message;
      elements.message.textContent = state.message;
    }
    if (previous.messageEnabled !== state.messageEnabled)
      elements.message.disabled = !state.messageEnabled;
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      const value = state.insets[edge];
      if (previous[edge] !== value) {
        rootStyle.setProperty("--" + edge, value + "px");
        previous[edge] = value;
      }
    }
    for (const key of [
      "mode",
      "recording",
      "selectionEnabled",
      "shutterEnabled",
      "switchEnabled",
      "flashEnabled",
      "flash",
      "zoom",
      "duration",
      "message",
      "messageEnabled",
    ] as const) {
      previous[key] = state[key];
    }
  }

  function showFocus(point: { x: number; y: number }) {
    if (focusAnimation) focusAnimation.cancel();
    const position = "translate3d(" + point.x + "px," + point.y + "px,0) translate(-50%,-50%)";
    const settled = position + " scale(1)";
    focusAnimation = elements.focus.animate(
      [
        {
          opacity: 0.9,
          transform: position + (motion.matches ? " scale(1)" : " scale(1.15)"),
        },
        { offset: 0.18, opacity: 0.9, transform: settled },
        { offset: 0.8, opacity: 0.9, transform: settled },
        { opacity: 0, transform: settled },
      ],
      { duration: 1000, easing: "ease-out" },
    );
  }

  function flush() {
    frame = 0;
    if (!visible) return;
    if (latestState) {
      const state = latestState;
      latestState = null;
      applyState(state);
    }
    const zoom = pendingZoom;
    const focus = pendingFocus;
    pendingZoom = 1;
    pendingFocus = null;
    if (cameraReady) {
      if (zoom !== 1) runtime.zoomBy({ factor: zoom });
      if (focus) {
        runtime.focus({
          x: focus.x / viewportWidth,
          y: focus.y / viewportHeight,
        });
        showFocus(focus);
      }
    }
  }

  window.PureCamera = Object.freeze({
    render(state) {
      cameraReady = state.ready;
      latestState = state;
      if (!cameraReady) resetGesture();
      schedule();
    },
  });

  function resetGesture() {
    gesture = false;
    pinching = false;
    lastDistance = 0;
    pendingZoom = 1;
    pendingFocus = null;
  }

  for (const binding of [
    ["message", "permission"],
    ["photo", "photo"],
    ["video", "video"],
    ["shutter", "shutter"],
    ["switch", "switch"],
    ["flash", "flash"],
    ["gallery", "gallery"],
  ] as const) {
    const id = binding[0],
      command = binding[1];
    elements[id].addEventListener("click", () => {
      if (visible) runtime.intent(command);
    });
  }

  const distance = (touches: TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  elements.viewfinder.addEventListener(
    "touchstart",
    (event) => {
      if (!visible || !cameraReady || (event.target as Element).closest("button")) return;
      if (event.touches.length === 1) {
        gesture = true;
        pinching = false;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        lastDistance = 0;
      } else if (event.touches.length === 2) {
        gesture = true;
        pinching = true;
        pendingFocus = null;
        lastDistance = distance(event.touches);
      } else {
        resetGesture();
      }
    },
    { passive: true },
  );

  elements.viewfinder.addEventListener(
    "touchmove",
    (event) => {
      if (!visible || !cameraReady || !gesture || event.touches.length !== 2) return;
      const next = distance(event.touches);
      if (lastDistance > 0 && next > 0) {
        pendingZoom = Math.max(0.01, Math.min(100, (pendingZoom * next) / lastDistance));
        schedule();
      }
      lastDistance = next;
      pinching = true;
    },
    { passive: true },
  );

  elements.viewfinder.addEventListener(
    "touchend",
    (event) => {
      if (!gesture) return;
      if (event.touches.length === 1) {
        lastDistance = 0;
        return;
      }
      if (event.touches.length !== 0) return;
      const end = event.changedTouches[0];
      if (!pinching && end && Math.hypot(end.clientX - startX, end.clientY - startY) < 15) {
        pendingFocus = { x: end.clientX, y: end.clientY };
        schedule();
      }
      gesture = false;
      lastDistance = 0;
    },
    { passive: true },
  );

  elements.viewfinder.addEventListener("touchcancel", resetGesture, {
    passive: true,
  });
  window.addEventListener(
    "resize",
    () => {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      resetGesture();
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    resetGesture();
    if (!visible) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (focusAnimation) focusAnimation.cancel();
      focusAnimation = null;
    } else if (latestState) {
      schedule();
    }
  });
  runtime = window.Visor.createRuntime(
    window.Visor.createBackend(window.VisorTransport, window.VisorBackendOptions),
    window.PureCamera.render,
  );
  window.addEventListener("pagehide", () => runtime.dispose(), { once: true });
})();
