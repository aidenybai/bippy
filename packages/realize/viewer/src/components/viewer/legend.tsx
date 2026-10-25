import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody } from "@/components/ui/table";
import type { ViewComponent } from "@/model";
import { useHoverStore } from "@/store/hover";
import { useIsPanelChosen, useIsPanelOpen, useUiStore } from "@/store/ui";
import { useActiveComponent, useViewer } from "./context";
import { BindingRow, HandlerRow, StateRow } from "./legend-rows";

const ComponentContext = createContext<ViewComponent | null>(null);

export const useLegendComponent = (): ViewComponent => {
  const component = useContext(ComponentContext);
  if (!component) throw new Error("useLegendComponent must be used inside <Legend>");
  return component;
};

interface SectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

const Section = ({ title, count, children }: SectionProps) => (
  <section className="grid gap-2">
    <header className="flex items-center gap-3">
      <h3 className="font-medium text-text-2">{title}</h3>
      <span className="h-px flex-1 bg-border" />
      {count > 0 && <span className="text-muted-foreground tabular-nums">{count}</span>}
    </header>
    {count === 0 ? (
      <p className="text-faint">None</p>
    ) : (
      <Table className="[&>tbody>tr:first-child]:border-t-0 [&>tbody>tr:last-child]:border-b-0">
        <TableBody>{children}</TableBody>
      </Table>
    )}
  </section>
);

interface ComponentPanelProps {
  component: ViewComponent;
  isOpen: boolean;
  isActive: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

const ComponentPanel = ({
  component,
  isOpen,
  isActive,
  onOpenChange,
  children,
}: ComponentPanelProps) => (
  <Collapsible
    open={isOpen}
    onOpenChange={onOpenChange}
    data-component={component.name}
    data-active={isActive || undefined}
    className="grid scroll-mt-4 gap-4 border-l-2 border-transparent pl-3 -ml-3 transition-colors duration-150 data-active:border-foreground/60"
  >
    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md text-left">
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90" />
      <h2 className={isActive ? "font-medium text-foreground" : "font-medium text-text-2"}>
        {component.name}
      </h2>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ComponentContext value={component}>
        <div className="grid gap-5 pb-2 pl-5">{children}</div>
      </ComponentContext>
    </CollapsibleContent>
  </Collapsible>
);

const isTopVisible = (element: Element, container: Element): boolean => {
  const box = element.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  return box.top >= bounds.top && box.top < bounds.bottom;
};

const useScrollActiveIntoView = (
  listRef: RefObject<HTMLDivElement | null>,
  activeName: string | null,
): { onMouseEnter: () => void; onMouseLeave: () => void } => {
  const isPointerInside = useRef(false);
  const handledName = useRef(activeName);
  useEffect(() => {
    const list = listRef.current;
    if (activeName === handledName.current) return;
    handledName.current = activeName;
    if (activeName === null || isPointerInside.current || !list) return;
    const panel = list.querySelector(`[data-component="${CSS.escape(activeName)}"]`);
    if (panel && !isTopVisible(panel, list))
      panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [listRef, activeName]);
  return {
    onMouseEnter: () => {
      isPointerInside.current = true;
    },
    onMouseLeave: () => {
      isPointerInside.current = false;
    },
  };
};

interface LegendPanelProps {
  component: ViewComponent;
  activeName: string | null;
  children: ReactNode;
}

const LegendPanel = ({ component, activeName, children }: LegendPanelProps) => {
  const focus = useHoverStore((state) => state.focus);
  const choosePanel = useUiStore((state) => state.choosePanel);
  const isOpen = useIsPanelOpen(component.name, activeName);
  return (
    <ComponentPanel
      component={component}
      isOpen={isOpen}
      isActive={component.name === activeName}
      onOpenChange={(open) => {
        choosePanel(component.name, open);
        if (open) focus(component.name);
      }}
    >
      {children}
    </ComponentPanel>
  );
};

const useKeepActiveOpen = (activeName: string | null): void => {
  const choosePanel = useUiStore((state) => state.choosePanel);
  const isChosen = useIsPanelChosen(activeName ?? "");
  useEffect(() => {
    if (activeName !== null && !isChosen) choosePanel(activeName, true);
  }, [activeName, isChosen, choosePanel]);
};

const Root = ({ children }: { children: ReactNode }) => {
  const { view } = useViewer();
  const activeComponent = useActiveComponent();
  const activeName = activeComponent?.name ?? null;
  useKeepActiveOpen(activeName);
  const listRef = useRef<HTMLDivElement>(null);
  const pointerHandlers = useScrollActiveIntoView(listRef, activeName);
  return (
    <div
      ref={listRef}
      {...pointerHandlers}
      className="grid h-full content-start gap-5 overflow-auto overscroll-none px-4 py-4 [scrollbar-gutter:stable] sm:px-5"
    >
      {view.components.map((component) => (
        <LegendPanel key={component.name} component={component} activeName={activeName}>
          {children}
        </LegendPanel>
      ))}
    </div>
  );
};

const Variables = () => {
  const component = useLegendComponent();
  return (
    <Section title="State variables" count={component.bindings.length}>
      {component.bindings.map((binding) => (
        <BindingRow key={binding.id} binding={binding} />
      ))}
    </Section>
  );
};

const States = () => {
  const component = useLegendComponent();
  const hasRegions = component.regions.length > 1;
  return component.regions.map((region) => (
    <Section
      key={region.states.join(",")}
      title={hasRegions ? `States of ${region.placeNames.join(", ")}` : "States"}
      count={region.states.length}
    >
      {region.states.map((stateIndex) => {
        const state = component.states[stateIndex];
        return state ? <StateRow key={stateIndex} state={state} /> : null;
      })}
    </Section>
  ));
};

const Actions = () => {
  const component = useLegendComponent();
  return (
    <Section title="Actions" count={component.handlers.length}>
      {component.handlers.map((handler) => (
        <HandlerRow key={handler.id} handler={handler} />
      ))}
    </Section>
  );
};

export const Legend = Object.assign(Root, { Variables, States, Actions });
