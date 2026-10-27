import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { Inspector } from "./inspector";
import { Viewer } from "./viewer";

export interface AppProps {
  examples: Example[];
  name: string;
  mode: ViewMode;
  view: ViewFile;
  json: string | null;
}

export const App = (props: AppProps) => (
  <Viewer {...props}>
    <Viewer.Toolbar />
    <Viewer.Panes
      source={<Viewer.Source />}
      inspector={
        <Viewer.Inspector>
          <Inspector.Variables />
          <Inspector.States />
          <Inspector.Actions />
        </Viewer.Inspector>
      }
    />
    <Viewer.Status />
  </Viewer>
);
