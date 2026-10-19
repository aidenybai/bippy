import type { Example } from "@/model";
import { Legend } from "./legend";
import { Viewer } from "./viewer";

export const App = ({ examples }: { examples: Example[] }) => (
  <Viewer examples={examples}>
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
