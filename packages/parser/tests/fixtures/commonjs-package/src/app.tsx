import { Badge, Card, LabelContext } from "cjs-kit";
import urlJoin from "umd-join";

export const App = () => (
  <LabelContext.Provider value="pokedex">
    <Card title="Bulbasaur" className="card">
      <p>Grass</p>
      <Badge label="seen" count={3} extras={{ stage: "beta", region: "eu" }} />
      <a href={urlJoin("/pokedex/", "bulbasaur/", ":form")}>{urlJoin(["/pokedex", "1/"])}</a>
    </Card>
  </LabelContext.Provider>
);
