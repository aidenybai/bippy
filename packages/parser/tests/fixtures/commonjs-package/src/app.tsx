import { Badge, Card, LabelContext } from "cjs-kit";
import { Spinner, useDelayed } from "umd-kit";
import urlJoin from "umd-join";
import { Registry, defaultLimit } from "cjs-statics";

const registry = new Registry().register("seen").register("caught");

export const App = () => {
  const isDelayed = useDelayed(false);
  return (
    <LabelContext.Provider value="pokedex">
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
    </LabelContext.Provider>
  );
};
