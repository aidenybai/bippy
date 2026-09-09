import Banner, { version } from "bundled-kit";
import { Badge, Card, LabelContext, Panel } from "cjs-kit";
import TopBar, { useTopBar } from "top-bar";
import { Spinner, useDelayed } from "umd-kit";
import { createRegistry, Stack, version as umdVersion } from "umd-return-kit";

const registry = createRegistry((state: Stack<string> | undefined, action) =>
  (state ?? new Stack<string>([])).push(typeof action.type === "string" ? "init" : "missing"),
);

const Toolbar = () => {
  const bar = useTopBar();
  return <button type="button" onClick={bar.start} />;
};

export const App = () => {
  const isDelayed = useDelayed(false);
  return (
    <LabelContext.Provider value="pokedex">
      <TopBar color="#f00" />
      <Toolbar />
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
      <Panel title="Moves">
        <ul />
      </Panel>
      <Banner tone="info">bundled {version}</Banner>
    </LabelContext.Provider>
  );
};
