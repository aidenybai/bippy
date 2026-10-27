import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { Inspector } from "./inspector";
import { Status } from "./status";
import { Toolbar } from "./toolbar";
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
    <Viewer.Toolbar>
      <Toolbar.Brand />
      <Toolbar.File />
      <Toolbar.Modes />
    </Viewer.Toolbar>
    <Viewer.Panes>
      <Viewer.Source />
      <Viewer.Inspector>
        <Inspector.Variables />
        <Inspector.States />
        <Inspector.Actions />
      </Viewer.Inspector>
    </Viewer.Panes>
    <Viewer.Status>
      <Status.Hover />
      <Status.Key />
      <Status.Controls />
    </Viewer.Status>
  </Viewer>
);
