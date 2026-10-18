import { useAnalysis } from "./hooks/use-analysis";
import { Viewer } from "./viewer/viewer";

export const App = () => {
  const analysis = useAnalysis(new URLSearchParams(window.location.search));
  if (analysis.status === "error")
    return <pre className="p-4 text-sm text-destructive">{analysis.message}</pre>;
  if (analysis.status === "loading")
    return <p className="p-4 text-sm text-muted-foreground">Analyzing…</p>;
  return (
    <Viewer component={analysis.component}>
      <Viewer.Toolbar />
      <Viewer.Panes>
        <Viewer.Source />
        <Viewer.Legend />
      </Viewer.Panes>
      <Viewer.Status />
    </Viewer>
  );
};
