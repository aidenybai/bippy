import { Legend } from "./viewer/legend";
import { Viewer } from "./viewer/viewer";

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
