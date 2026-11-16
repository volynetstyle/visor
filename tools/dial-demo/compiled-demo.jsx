import { render, signal, get, set, onCleanup } from "@visor/framework";
export { batch } from "@visor/framework";

export const count = signal(46);
export const setValue = (value) => set(count, value);
export const stats = { mounts: 0, disposals: 0 };
function DialReadout() {
  stats.mounts++;
  onCleanup(() => stats.disposals++);
  return (
    <section class="compiled-dial" aria-label="Quant DOM compiler demo">
      <h1>Quant × DOM Expressions</h1>
      <p>Compiled JSX · direct DOM</p>
      <output aria-live="polite">{get(count)}</output>
      <svg viewBox="0 0 340 77" aria-hidden="true">
        <path d="M0 21 C45 27 105 30 170 30 C235 30 295 27 340 21" fill="none" stroke="#444" />
        <rect x="0" y="45" height="3" width={get(count) * 3.4} fill="#da8737" />
      </svg>
      <button onClick={() => set(count, Math.max(0, get(count) - 1))}>−</button>
      <button onClick={() => set(count, Math.min(100, get(count) + 1))}>+</button>
    </section>
  );
}
export const stop = render(() => <DialReadout />, document.getElementById("compiled"));
