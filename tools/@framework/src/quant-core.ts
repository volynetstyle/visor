import * as quant from "reflex-quant";
export const sharedConfig: Record<string, unknown> = {};
export const untrack = quant.untracked;
type Cleanup = () => void;
export interface Owner {
  readonly cleanups: Set<Cleanup>;
  dead: boolean;
}
let owner: Owner | null = null;
export const getOwner = (): Owner | null => owner;
function enter<T>(scope: Owner, fn: () => T): T {
  const previous = owner;
  owner = scope;
  try {
    return fn();
  } finally {
    owner = previous;
  }
}
function clear(scope: Owner): void {
  const errors: unknown[] = [];
  const cleanups = [...scope.cleanups].reverse();
  scope.cleanups.clear();
  for (const fn of cleanups) {
    try {
      fn();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Quant DOM cleanup failed");
}
export function onCleanup(fn: Cleanup): Cleanup {
  if (!owner || owner.dead) throw new Error("onCleanup requires a live framework owner");
  owner.cleanups.add(fn);
  return fn;
}
export function root<T>(fn: (dispose: Cleanup) => T, parent: Owner | null = owner): T {
  if (parent?.dead) throw new Error("Cannot mount under a disposed owner");
  const scope: Owner = { cleanups: new Set(), dead: false };
  const stop = () => {
    if (scope.dead) return;
    scope.dead = true;
    parent?.cleanups.delete(stop);
    quant.untracked(() => clear(scope));
  };
  parent?.cleanups.add(stop);
  try {
    return enter(scope, () => fn(stop));
  } catch (error) {
    stop();
    throw error;
  }
}
export function effect<T>(fn: (previous: T) => T, initial: T): quant.Effect;
export function effect<T>(fn: (previous: T | undefined) => T): quant.Effect;
export function effect<T>(
  fn: ((previous: T) => T) | ((previous: T | undefined) => T),
  initial?: T,
): quant.Effect {
  const parent = owner;
  if (!parent || parent.dead) throw new Error("DOM effects must be created inside render/root");
  const scope: Owner = { cleanups: new Set(), dead: false };
  let previous = initial;
  let handle: quant.Effect;
  try {
    handle = quant.effect(() => {
      quant.untracked(() => clear(scope));
      previous = enter(scope, () => (fn as (previous: T | undefined) => T)(previous));
    });
  } catch (error) {
    scope.dead = true;
    quant.untracked(() => clear(scope));
    throw error;
  }
  parent.cleanups.add(() => {
    quant.dispose(handle);
    scope.dead = true;
    quant.untracked(() => clear(scope));
  });
  return handle;
}
export function memo<T>(fn: () => T, _equal?: boolean): () => T {
  if (!owner || owner.dead) throw new Error("memo requires a live framework owner");
  const source = quant.computed(fn);
  onCleanup(() => quant.dispose(source));
  return () => quant.get(source);
}
export function createComponent<P, T>(Component: (props: P) => T, props: P): T {
  return quant.untracked(() => Component(props));
}
type Source = object | (() => object);
type Resolve<T> = T extends () => infer R ? R : T;
type Merge<S extends readonly unknown[]> = S extends readonly [infer Head, ...infer Tail]
  ? Omit<Resolve<Head>, keyof Merge<Tail>> & Merge<Tail>
  : {};
export function mergeProps<S extends readonly Source[]>(...sources: S): Merge<S> {
  const objects = () => sources.map((s) => (typeof s === "function" ? s() : s));
  return new Proxy(
    {},
    {
      get(_, key) {
        const list = objects() as Record<PropertyKey, unknown>[];
        for (let i = list.length - 1; i >= 0; i--)
          if (list[i][key] !== undefined) return list[i][key];
      },
      has(_, key) {
        return objects().some((s) => key in s);
      },
      ownKeys() {
        return [...new Set(objects().flatMap((s) => Reflect.ownKeys(s)))];
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
    },
  ) as Merge<S>;
}
