import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody } from "@/components/ui/table";
import type { ViewComponent } from "../model";
import { useHoverStore } from "../store/hover";
import { useActiveComponent, useLoadedView } from "./context";
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
    className="grid gap-4 border-l-2 border-transparent pl-3 -ml-3 transition-colors duration-150 data-active:border-foreground/60"
  >
    <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md text-left">
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90" />
      <h2 className={isActive ? "font-medium text-foreground" : "font-medium text-text-2"}>
        {component.name}
      </h2>
      <span className="ml-auto text-muted-foreground tabular-nums">
        {component.states.length} states · {component.handlers.length} actions
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ComponentContext value={component}>
        <div className="grid gap-5 pb-2 pl-5">{children}</div>
      </ComponentContext>
    </CollapsibleContent>
  </Collapsible>
);

const useOpenNames = (
  activeName: string | null,
): [Set<string>, (name: string, open: boolean) => void] => {
  const [openNames, setOpenNames] = useState(() => new Set(activeName ? [activeName] : []));
  useEffect(() => {
    if (activeName !== null)
      setOpenNames((current) =>
        current.has(activeName) ? current : new Set([...current, activeName]),
      );
  }, [activeName]);
  const setOpen = (name: string, open: boolean): void =>
    setOpenNames((current) => {
      const next = new Set(current);
      if (open) next.add(name);
      else next.delete(name);
      return next;
    });
  return [openNames, setOpen];
};

const useScrollActiveIntoView = (
  listRef: RefObject<HTMLDivElement | null>,
  activeName: string | null,
): { onMouseEnter: () => void; onMouseLeave: () => void } => {
  const isPointerInside = useRef(false);
  useEffect(() => {
    if (activeName === null || isPointerInside.current) return;
    listRef.current
      ?.querySelector(`[data-component="${CSS.escape(activeName)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

const Root = ({ children }: { children: ReactNode }) => {
  const view = useLoadedView();
  const activeComponent = useActiveComponent();
  const focus = useHoverStore((state) => state.focus);
  const activeName = activeComponent?.name ?? null;
  const [openNames, setOpen] = useOpenNames(activeName);
  const listRef = useRef<HTMLDivElement>(null);
  const pointerHandlers = useScrollActiveIntoView(listRef, activeName);
  return (
    <div
      ref={listRef}
      {...pointerHandlers}
      className="grid h-full content-start gap-5 overflow-auto overscroll-none px-4 py-4 sm:px-5"
    >
      {view.components.map((component) => (
        <ComponentPanel
          key={component.name}
          component={component}
          isOpen={openNames.has(component.name)}
          isActive={component.name === activeName}
          onOpenChange={(open) => {
            setOpen(component.name, open);
            if (open) focus(component.name);
          }}
        >
          {children}
        </ComponentPanel>
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
  return component.regions.map((region, regionIndex) => (
    <Section
      key={region.placeNames.join(",") || regionIndex}
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
