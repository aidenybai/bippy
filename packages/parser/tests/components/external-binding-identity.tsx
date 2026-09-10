import { EventEmitter, once } from "./shared/node-events";

/** Library defaults merged with user overrides, as icon/component registries do. */
const defaults: Record<string, unknown> = { emitter: EventEmitter, once: undefined };
const overrides: Record<string, unknown> = { once, emitter: undefined };

const merged: Record<string, unknown> = { ...defaults };
Object.entries(overrides).forEach(([key, value]) => {
  if (value !== undefined) merged[key] = value;
});

const Entry = ({ name }: { name: string }) => <li>{name}</li>;

/** An import from a module the analysis never opens is still a defined value, so `=== undefined` is decided. */
export default function ExternalBindingIdentity() {
  return (
    <ul>
      {merged.emitter !== undefined ? <Entry name="emitter" /> : <li>no emitter</li>}
      {merged.once === undefined ? <li>no once</li> : <Entry name="once" />}
      {Object.keys(merged).length === 2 ? <li>two entries</li> : null}
    </ul>
  );
}
