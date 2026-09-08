import Banner, { version } from "bundled-kit";
import { Badge, Card, LabelContext } from "cjs-kit";
import { Spinner, useDelayed } from "umd-kit";
import { createRegistry, Stack, version as umdVersion } from "umd-return-kit";

const registry = createRegistry(
  (state: Stack<string> | undefined, action) =>
    (state ?? new Stack<string>([])).push(typeof action.type === "string" ? "init" : "missing"),
);

export const App = () => {
  const isDelayed = useDelayed(false);
  return (
    <LabelContext.Provider value="pokedex">
      <ul>
        {registry
          .getState()
          .toArray()
          .map((name) => (
            <li key={name}>
              {name} via umd {umdVersion}
            </li>
          ))}
      </ul>
      <Card title="Bulbasaur" className="card">
        <p>Grass</p>
        <Badge label="seen" count={3} />
        {isDelayed ? <em>late</em> : <Spinner isActive />}
      </Card>
      <Banner tone="info">bundled {version}</Banner>
    </LabelContext.Provider>
  );
};
