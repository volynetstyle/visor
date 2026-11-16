export {
  render,
  template,
  insert,
  spread,
  assign,
  setAttribute,
  setAttributeNS,
  setBoolAttribute,
  setProperty,
  setStyleProperty,
  className,
  classList,
  style,
  addEventListener,
  delegateEvents,
  clearDelegatedEvents,
  dynamicProperty,
  use,
  Properties,
  ChildProperties,
  Aliases,
  getPropAlias,
  SVGNamespace,
} from "dom-expressions/src/client.js";
export { signal, computed, get, set, batch, peek, dispose, untracked } from "reflex-quant";
export type { Readable, Signal, Computed, Effect } from "reflex-quant";
export {
  root,
  effect,
  memo,
  onCleanup,
  getOwner,
  createComponent,
  mergeProps,
  untrack,
} from "./quant-core.js";
export type { Owner } from "./quant-core.js";
export type { JSX } from "dom-expressions/src/jsx.js";
