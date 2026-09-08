import { Badge, Card, LabelContext, Panel } from "cjs-kit";
import TopBar, { useTopBar } from "top-bar";

const Toolbar = () => {
  const bar = useTopBar();
  return <button type="button" onClick={bar.start} />;
};

export const App = () => (
  <LabelContext.Provider value="pokedex">
    <TopBar color="#f00" />
    <Toolbar />
    <Card title="Bulbasaur" className="card">
      <p>Grass</p>
      <Badge label="seen" count={3} />
    </Card>
    <Panel title="Moves">
      <ul />
    </Panel>
  </LabelContext.Provider>
);
