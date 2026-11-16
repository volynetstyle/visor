import { signal, set, get, computed, render, mergeProps } from "@visor/framework";
import { createScope } from "@visor/framework/frame";
const value = signal(46);
const width = computed(() => get(value) * 3.4);
// @ts-expect-error computed values cannot be assigned
set(width, 3);
// @ts-expect-error signals preserve their value type
set(value, "46");
const props = mergeProps({ label: "Dial", value: 1 }, { value: "latest" });
const label: string = props.label;
const latest: string = props.value;
void label;
void latest;
const scope = createScope();
scope.prop(document.createElement("input"), "checked", () => true);
// @ts-expect-error checked is boolean
scope.prop(document.createElement("input"), "checked", () => "true");
render(
  () => (
    <section aria-label="Value">
      <output>{get(value)}</output>
      <svg>
        <rect width={get(width)} height="3" />
      </svg>
      <button onClick={() => set(value, 47)}>+</button>
    </section>
  ),
  document.body,
);
