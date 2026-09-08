import { counter, getNames } from "./shared/registry";

export default function ModuleRegistry() {
  return (
    <div>
      <ul>
        {getNames().map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {counter.count > 0 && <p>ticked {counter.count}</p>}
    </div>
  );
}
