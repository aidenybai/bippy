import { Viewer } from "./viewer/viewer";

export const App = () => (
  <Viewer>
    <Viewer.Toolbar />
    <Viewer.Panes>
      <Viewer.Source />
      <Viewer.Legend />
    </Viewer.Panes>
    <Viewer.Status />
  </Viewer>
);
