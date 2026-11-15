"use strict";
const replay = window.VisorReplay.createReplay(window.VisorScenario);
window.VisorTransport = replay;
window.VisorBackendOptions = { clock: replay.clock };
document.getElementById("replay-step").addEventListener("click", () => {
  replay.advance(1000);
  document.getElementById("replay-time").textContent = replay.inspect().now + " ms";
});
