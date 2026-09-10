import { defaults, isFunction, isPlainObject, keys, pick } from "lodash-es";

const handlers = {
  onOpen: () => "opened",
  onClose: () => "closed",
};

/** react-dnd's `DropTarget(spec)` guard: a spec made of functions is still a plain object. */
const isSpecPlain = isPlainObject(handlers);

/** Functions round-trip through a pure call with their identity intact. */
const merged = defaults({ onOpen: () => "custom" }, handlers);
const picked = pick(handlers, ["onClose"]);

const registry = new Map<string, () => string>([["open", handlers.onOpen]]);

export default function FunctionsThroughNatives() {
  return (
    <dl>
      <dt>plain</dt>
      <dd>{String(isSpecPlain)}</dd>
      <dt>callable</dt>
      <dd>{String(isFunction(handlers.onOpen))}</dd>
      <dt>defaults</dt>
      <dd>
        {merged.onOpen()} {merged.onClose()} {String(merged.onClose === handlers.onClose)}
      </dd>
      <dt>pick</dt>
      <dd>
        {keys(picked).join(",")} {picked.onClose?.()}
      </dd>
      <dt>map</dt>
      <dd>{registry.get("open")?.()}</dd>
    </dl>
  );
}

export const isExact = true;
