import { createDial } from "./dial.js";

for (const [index, root] of [...document.querySelectorAll("section[data-label]")].entries()) {
  root.className = "dial";
  root.innerHTML = `<div class="dial-label"></div><div class="dial-value"></div><div class="dial-caret" aria-hidden="true"></div><div class="dial-window" aria-hidden="true">
    <svg class="dial-geometry" viewBox="0 0 340 77" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="ticks-${index}" width="50" height="77" patternUnits="userSpaceOnUse">
          <path d="M0 0V25" stroke="#fff" stroke-opacity=".8"/>
          <path d="M10 0V25 M20 0V25 M30 0V25 M40 0V25" stroke="#d9dce1" stroke-opacity=".5"/>
        </pattern>
        <clipPath id="curve-${index}"><path d="M0 0 C45 6 105 9 170 9 C235 9 295 6 340 0 L340 7 C295 13 235 16 170 16 C105 16 45 13 0 7 Z"/></clipPath>
        <clipPath id="trail-${index}"><rect class="dial-trail-clip" x="170" y="0" width="0" height="77"/></clipPath>
      </defs>
      <g clip-path="url(#curve-${index})"><g class="dial-ruler"><rect x="-100" y="0" width="540" height="25" fill="url(#ticks-${index})"/></g></g>
      <g class="dial-dots" fill="none" stroke="#d3d9e4" stroke-width="2" stroke-linecap="round" stroke-dasharray=".01 9">
        <path d="M0 28 C45 34 105 37 170 37 C235 37 295 34 340 28"/>
        <path d="M0 36 C45 42 105 45 170 45 C235 45 295 42 340 36"/>
        <path d="M0 44 C45 50 105 53 170 53 C235 53 295 50 340 44"/>
        <path d="M0 52 C45 58 105 61 170 61 C235 61 295 58 340 52"/>
        <path d="M0 60 C45 66 105 69 170 69 C235 69 295 66 340 60"/>
      </g>
      <g clip-path="url(#trail-${index})"><path class="dial-trail" d="M0 21 C45 27 105 30 170 30 C235 30 295 27 340 21"/></g>
    </svg>
    <div class="dial-center"></div></div><div class="dial-ends" aria-hidden="true"><span></span><span></span></div>`;
  root.querySelector(".dial-label").textContent = root.dataset.label;
  root.querySelector(".dial-ends span:first-child").textContent = root.dataset.left;
  root.querySelector(".dial-ends span:last-child").textContent = root.dataset.right;
  createDial(root, { label: root.dataset.label, min: -100, max: 100, initial: Number(root.dataset.value) });
}
