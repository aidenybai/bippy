import type { ReactNode } from "react";
import type { ViewComponent } from "../model";
import { ViewerProvider, useViewer } from "./context";
import { Legend } from "./legend";
import { SourcePane } from "./source-pane";

const Root = ({ component, children }: { component: ViewComponent; children: ReactNode }) => (
  <ViewerProvider component={component}>
    <div className="grid h-screen grid-rows-[auto_minmax(0,1fr)_auto]">{children}</div>
  </ViewerProvider>
);

const Toolbar = () => {
  const { component } = useViewer();
  return (
    <div className="flex h-9 items-center gap-2 border-b px-3 text-xs">
      <span className="font-semibold">{component.name}</span>
      <span className="text-muted-foreground">{component.file.split("/").slice(-2).join("/")}</span>
    </div>
  );
};

const Panes = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_420px] overflow-hidden">{children}</div>
);

const Status = () => {
  const { hoveredNode } = useViewer();
  return (
    <div className="flex h-8 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      {hoveredNode && (
        <>
          <span>
            Line {hoveredNode.loc.start.line}, Offset {hoveredNode.loc.start.column}
          </span>
          <span>{hoveredNode.label}</span>
        </>
      )}
    </div>
  );
};

export const Viewer = Object.assign(Root, { Toolbar, Panes, Source: SourcePane, Legend, Status });
