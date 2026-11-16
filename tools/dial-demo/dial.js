import { createScope, get } from "@visor/framework/frame";
import { dispose } from "@visor/framework";
import { createDialModel } from "./dial-model.js";

export function createDial(root, options) {
  const { label, min, max, step = 1, unitsPerPixel = 0.25, onChange = () => {} } = options;
  const model = createDialModel(options);
  const scope = createScope();
  for (const source of [model.value, model.formatted, model.trailWidth, model.trailX])
    scope.own(() => dispose(source));
  const notifyKey = {};
  let pointer = null,
    velocity = 0;
  scope.attr(root, "role", () => "slider");
  scope.attr(root, "tabindex", () => "0");
  scope.attr(root, "aria-label", () => label);
  scope.attr(root, "aria-valuemin", () => min);
  scope.attr(root, "aria-valuemax", () => max);
  scope.attr(root, "aria-valuenow", () => get(model.value));
  scope.attr(root, "aria-valuetext", () => get(model.formatted));
  scope.text(root.querySelector(".dial-value"), () => get(model.formatted));
  scope.style(
    root.querySelector(".dial-ruler"),
    "transform",
    () => "translateX(" + get(model.offset) + "px)",
  );
  const trail = root.querySelector(".dial-trail-clip");
  if (trail) {
    scope.attr(trail, "x", () => get(model.trailX));
    scope.attr(trail, "width", () => get(model.trailWidth));
  }
  function update(next, emit = true) {
    const before = get(model.value);
    model.update(next);
    if (!emit) scope.cancel(notifyKey);
    else if (before !== get(model.value)) scope.frame(notifyKey, () => onChange(get(model.value)));
  }
  function down(event) {
    if (pointer || event.button !== 0 || document.hidden) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
    root.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const elapsed = Math.max(1, event.timeStamp - pointer.time);
    velocity = dx / elapsed;
    const precision = Math.max(0.1, Math.min(1, 1 - Math.max(0, event.clientY - pointer.y) / 120));
    update(get(model.raw) + dx * unitsPerPixel * precision);
    pointer.x = event.clientX;
    pointer.time = event.timeStamp;
  }
  function end(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer = null;
    velocity = 0;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  }
  function key(event) {
    let next = get(model.raw);
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = get(model.value) + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = get(model.value) - step;
    else if (event.key === "PageUp") next = get(model.value) + step * 10;
    else if (event.key === "PageDown") next = get(model.value) - step * 10;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    update(next);
  }
  function wheel(event) {
    event.preventDefault();
    update(get(model.raw) - event.deltaY * unitsPerPixel * 0.2);
  }
  function visibility() {
    if (document.hidden) {
      if (pointer && root.hasPointerCapture(pointer.id)) root.releasePointerCapture(pointer.id);
      pointer = null;
      velocity = 0;
    }
  }
  scope.on(root, "pointerdown", down);
  scope.on(root, "pointermove", move);
  scope.on(root, "pointerup", end);
  scope.on(root, "pointercancel", end);
  scope.on(root, "lostpointercapture", end);
  scope.on(root, "keydown", key);
  scope.on(root, "wheel", wheel, { passive: false });
  scope.on(document, "visibilitychange", visibility);

  return {
    get value() {
      return get(model.value);
    },
    get velocity() {
      return velocity;
    },
    setValue(next) {
      update(next, false);
    },
    dispose() {
      if (pointer && root.hasPointerCapture(pointer.id)) root.releasePointerCapture(pointer.id);
      scope.cancel(notifyKey);
      scope.dispose();
    },
  };
}
