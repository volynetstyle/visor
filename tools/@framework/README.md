# @visor/framework

TypeScript UI library for Quant + DOM Expressions. The package owns the reusable
runtime; `../dial-demo` contains only consumers and examples. Private local
package, version 0.1.0; not published to npm.

## Install, build, test

With Node 22 and npm on PATH, from this directory (`tools/@framework`):

```sh
npm ci
npm run typecheck
npm run build
npm test
```

The repository's local Node installation is `.pixi/envs/web-check`. Generated
JavaScript, declarations, declaration maps and source maps go to `dist/`.
`node_modules/` and `dist/` are ignored by Git. The lockfile pins tool versions.

## Entry points

| Import | Purpose |
| --- | --- |
| `@visor/framework` | Compiled DOM renderer, reactive primitives, owners and cleanup |
| `@visor/framework/frame` | Explicit frame-coalesced bindings for manually mounted HUD controls |
| `@visor/framework/compiler` | `jsxOptions()` for the Babel JSX transform |
| `@visor/framework/jsx-runtime` | JSX types for TypeScript in `jsx: preserve` mode |

`reflex-quant@1.2.0` is a peer dependency. The library leaves it external so
consumers and the renderer share one graph instance. Keep one resolved Quant
installation in a consuming bundle. DOM Expressions 0.40.14 is bundled into the
main entry; no Solid runtime is used.

## Compiled JSX / TSX

```tsx
import { render, signal, get, set, onCleanup } from '@visor/framework';
const value = signal(46);
const stop = render(() => {
  onCleanup(() => console.log('unmounted'));
  return <section>
    <output>{get(value)}</output>
    <svg><rect width={get(value) * 3.4} height="3" /></svg>
    <button onClick={() => set(value, get(value) + 1)}>+</button>
  </section>;
}, document.body);
// stop() releases owners/effects and clears the mount container.
```

Configure TypeScript with `jsx: "preserve"` and
`jsxImportSource: "@visor/framework"`. HTML/SVG JSX types come from
DOM Expressions. Babel must transform the JSX, with TypeScript syntax removed
by your TS/Babel pipeline when using TSX:

```js
import jsx from 'babel-plugin-jsx-dom-expressions';
import { jsxOptions } from '@visor/framework/compiler';
const babelOptions = { plugins: [[jsx, jsxOptions()]] };
```

Install Babel and `babel-plugin-jsx-dom-expressions@0.40.14` in the consuming
build environment. Bundle the compiler output with esbuild or equivalent.
Consumers no longer need an `rxcore` alias: that adapter is already incorporated
into `dist/index.js`. The package's own build aliases `rxcore` to
`src/quant-core.ts` when bundling upstream DOM Expressions.

Static JSX becomes cached native templates. Dynamic expressions become
fine-grained effects. Components mount once; Quant tracks dependencies and
updates the relevant DOM nodes synchronously. `batch()` combines model writes.
Nested effects and roots are owned, and are disposed on parent rerun/unmount.
The low-level `effect` export follows DOM Expressions' previous-value contract;
its callback return value is the next previous value. Use `onCleanup` for
resources, not a returned callback. Low-level reactive computeds created by the
public Quant `computed()` API remain explicitly managed; use owned `memo()` or
register `dispose(computedHandle)` with `onCleanup` when appropriate.

## Explicit frame bindings

```ts
import { createScope, signal, get, set } from '@visor/framework/frame';
const scope = createScope();
const value = signal(46);
scope.text(output, () => get(value));
scope.attr(rect, 'width', () => get(value) * 3.4);
scope.style(ruler, 'transform', () => `translateX(${get(value)}px)`);
scope.on(button, 'click', () => set(value, get(value) + 1));
// scope.dispose() removes listeners, subscriptions and pending writes.
```

One shared, on-demand rAF retains the latest write per binding. Values equal to
the committed value cause no DOM write. Hidden documents cancel the frame and
retain latest projections for visibility return. Frames do not read layout.
Dispose explicitly when removing manually mounted controls. The synchronous JSX
runtime does not silently use this queue or pause writes in hidden documents.

## Scope and limits

Browser client rendering only. No SSR/hydration, Solid-specific APIs or automatic
JSX runtime functions. `jsx-runtime` supplies types for preserved JSX, not
React-style runtime rendering. There is no virtual DOM; dynamic arrays use
upstream DOM reconciliation. Native event listeners on removed nodes are
collected with those nodes; release global resources with `onCleanup`.

Tests compile real JSX, exercise HTML/SVG updates, native events, 10,000 identical
values with zero mutations, a batch of 1,000 writes, 20 conditional mount cycles,
teardown, frame coalescing/visibility and TypeScript/TSX contracts. They establish
semantics, not superiority over handwritten DOM or a browser/GPU speed guarantee.
The production Android HUD is not connected to this package yet.

For the examples: build this package first, then run `npm ci` and `npm start`
from `../dial-demo`. Open `/` for the rulers and `/compiled` for compiled JSX.
