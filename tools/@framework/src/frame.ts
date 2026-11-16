import { effect, dispose } from "reflex-quant";
export { signal, computed, get, set, batch, peek, untracked } from "reflex-quant";
type Cleanup = () => void;
export interface FrameHost {
  acquire(): void;
  release(): void;
  write(key: unknown, fn: Cleanup): void;
  remove(key: unknown): void;
}
export interface Scope {
  own(fn: Cleanup): Cleanup;
  bind<T>(read: () => T, write: (value: T) => void): void;
  text(node: Pick<Node, "textContent">, read: () => unknown): void;
  attr(
    node: Pick<Element, "setAttribute" | "removeAttribute">,
    name: string,
    read: () => unknown,
  ): void;
  style(node: Pick<HTMLElement, "style">, name: string, read: () => unknown): void;
  prop<N, K extends keyof N>(node: N, name: K, read: () => N[K]): void;
  on<E extends Event>(
    node: EventTarget,
    event: string,
    fn: (event: E) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  frame(key: unknown, fn: Cleanup): void;
  cancel(key: unknown): void;
  dispose(): void;
}
export function createHost(
  doc: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document,
  request: typeof requestAnimationFrame = requestAnimationFrame,
  cancel: typeof cancelAnimationFrame = cancelAnimationFrame,
): FrameHost {
  const pending = new Map<unknown, Cleanup>();
  let frame = 0,
    users = 0;
  const schedule = () => {
    if (pending.size && !frame && !doc.hidden) frame = request(flush);
  };
  function flush(): void {
    frame = 0;
    if (doc.hidden) return;
    const writes = [...pending.values()],
      errors: unknown[] = [];
    pending.clear();
    for (const write of writes) {
      try {
        write();
      } catch (error) {
        errors.push(error);
      }
    }
    schedule();
    if (errors.length) throw new AggregateError(errors, "Frame writes failed");
  }
  function visibility(): void {
    if (frame) cancel(frame);
    frame = 0;
    schedule();
  }
  return {
    acquire() {
      if (!users++) doc.addEventListener("visibilitychange", visibility);
    },
    release() {
      if (!--users) doc.removeEventListener("visibilitychange", visibility);
    },
    write(key, fn) {
      pending.set(key, fn);
      schedule();
    },
    remove(key) {
      pending.delete(key);
      if (!pending.size && frame) {
        cancel(frame);
        frame = 0;
      }
    },
  };
}
let shared: FrameHost | undefined;
export function createScope(host: FrameHost = (shared ||= createHost())): Scope {
  host.acquire();
  const cleanups: Cleanup[] = [],
    jobs = new Set<unknown>();
  let dead = false;
  const own = (fn: Cleanup) => {
    if (dead) fn();
    else cleanups.push(fn);
    return fn;
  };
  function binding<T>(read: () => T, write: (value: T) => void): void {
    if (dead) return;
    const key = {};
    let previous: T,
      initialized = false;
    const observer = effect(() => {
      const latest = read();
      host.write(key, () => {
        if (dead || (initialized && Object.is(previous, latest))) return;
        write(latest);
        previous = latest;
        initialized = true;
      });
    });
    own(() => {
      dispose(observer);
      host.remove(key);
    });
  }
  return {
    own,
    bind: binding,
    text(node, read) {
      binding(
        () => String(read() ?? ""),
        (value) => {
          node.textContent = value;
        },
      );
    },
    attr(node, name, read) {
      binding(
        () => {
          const v = read();
          return v == null ? null : String(v);
        },
        (value) => {
          if (value === null) node.removeAttribute(name);
          else node.setAttribute(name, value);
        },
      );
    },
    style(node, name, read) {
      binding(
        () => String(read() ?? ""),
        (value) => node.style.setProperty(name, value),
      );
    },
    prop(node, name, read) {
      binding(read, (value) => {
        node[name] = value;
      });
    },
    on(node, event, fn, options) {
      if (dead) return;
      node.addEventListener(event, fn as EventListener, options);
      own(() => node.removeEventListener(event, fn as EventListener, options));
    },
    frame(key, fn) {
      if (!dead) {
        jobs.add(key);
        host.write(key, () => {
          jobs.delete(key);
          if (!dead) fn();
        });
      }
    },
    cancel(key) {
      jobs.delete(key);
      host.remove(key);
    },
    dispose() {
      if (dead) return;
      dead = true;
      for (const key of jobs) host.remove(key);
      jobs.clear();
      const errors: unknown[] = [];
      for (const fn of cleanups.reverse()) {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      }
      cleanups.length = 0;
      host.release();
      if (errors.length) throw new AggregateError(errors, "Frame scope cleanup failed");
    },
  };
}
