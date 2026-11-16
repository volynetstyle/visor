# Dial prototype

Build the TypeScript library in [../@framework](../@framework/README.md) first:
run `npm ci` and `npm run build` from `tools/@framework`. Then run `npm ci` and
`npm start` from `tools/dial-demo`. Open http://127.0.0.1:4173 for the Dial or
http://127.0.0.1:4173/compiled for compiled JSX. Stop the server with Ctrl+C.

The demo consumes `@visor/framework` through a local package dependency. Its
runtime source lives entirely in `tools/@framework/src/`; there is no copy here.
The Dial separates its Quant model from DOM projections and gesture handlers.

Drag horizontally; moving down while dragging changes precision. Arrow keys, Page Up/Down, Home/End and mouse wheel are supported. `createDial` in `dial.js` takes bounds, step, initial value, sensitivity, formatting and an `onChange` callback; `setValue()` updates it without sending a change event, and `dispose()` removes listeners. Values are clamped and rounded to steps anchored at `min`. The component does not access the camera or modify the production HUD.

The demo is a standalone prototype, outside the Android WebView performance budget; integrating it into the camera requires adapting its markup and styles to the HUD invariants and connecting it to a supported parameter. It does not implement inertia, haptics, nonlinear scales or GPU measurements.

The accent arc starts at zero (or the nearest bound if zero is outside the range), extends left for negative and right for positive values, and reaches the edge at the corresponding bound.
