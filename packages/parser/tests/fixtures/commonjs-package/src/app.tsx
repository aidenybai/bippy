import { Badge, Card, LabelContext } from "cjs-kit";
import { Spinner, useDelayed } from "umd-kit";

export const App = () => {
  const isDelayed = useDelayed(false);
  return (
    <LabelContext.Provider value="pokedex">
      <Card title="Bulbasaur" className="card">
        <p>Grass</p>
        <Badge label="seen" count={3} />
        {isDelayed ? <em>late</em> : <Spinner isActive />}
      </Card>
    </LabelContext.Provider>
  );
};
