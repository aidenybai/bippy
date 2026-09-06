import { Badge, Card, LabelContext } from "cjs-kit";

export const App = () => (
  <LabelContext.Provider value="pokedex">
    <Card title="Bulbasaur" className="card">
      <p>Grass</p>
      <Badge label="seen" count={3} />
    </Card>
  </LabelContext.Provider>
);
