import { Legend } from "./legend";
import { Viewer } from "./viewer";

export const App = () => (
  <Viewer>
    <Viewer.Toolbar />
    <Viewer.Panes
      source={<Viewer.Source />}
      legend={
        <Viewer.Legend>
          <Legend.Variables />
          <Legend.States />
          <Legend.Actions />
        </Viewer.Legend>
      }
    />
    <Viewer.Status />
  </Viewer>
);
