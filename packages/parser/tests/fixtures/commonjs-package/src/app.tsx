import Banner, { version } from "bundled-kit";
import { Badge, Card, LabelContext, Panel } from "cjs-kit";
import TopBar, { useTopBar } from "top-bar";
import { Spinner, useDelayed } from "umd-kit";
import urlJoin from "umd-join";
import { Registry, defaultLimit } from "cjs-statics";
import { createRegistry, Stack, version as umdVersion } from "umd-return-kit";
import { Tag, buildKind } from "env-switch-kit";

const registry = new Registry().register("seen").register("caught");

const store = createRegistry((state: Stack<string> | undefined, action) =>
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
        {store
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
        <Badge label="seen" count={3} extras={{ stage: "beta", region: "eu" }} />
        <a href={urlJoin("/pokedex/", "bulbasaur/", ":form")}>{urlJoin(["/pokedex", "1/"])}</a>
        {isDelayed ? <em>late</em> : <Spinner isActive />}
        <ul data-limit={defaultLimit}>
          {registry.names().map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </Card>
      <Panel title="Moves">
        <ul />
      </Panel>
      <Banner tone="info">bundled {version}</Banner>
      <Tag>{buildKind} build</Tag>
    </LabelContext.Provider>
  );
};
