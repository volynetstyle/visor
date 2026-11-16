import { render, signal, get, set, onCleanup } from "@visor/framework";
const visible = signal(true),
  count = signal(1);
export const stats = { mounted: 0, disposed: 0 };
function Child() {
  stats.mounted++;
  onCleanup(() => stats.disposed++);
  return <span>{get(count)}</span>;
}
export const setVisible = (value) => set(visible, value);
export const setCount = (value) => set(count, value);
export const stop = render(
  () => <div>{get(visible) ? <Child /> : null}</div>,
  document.getElementById("compiled"),
);
