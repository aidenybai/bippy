import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { Legend } from "./legend";
import { Viewer } from "./viewer";

export interface AppProps {
  examples: Example[];
  name: string | null;
  mode: ViewMode;
  view: ViewFile | null;
  json: string | null;
}

export const App = (props: AppProps) => (
  <Viewer {...props}>
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
