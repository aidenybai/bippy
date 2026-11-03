import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Table, TableBody } from "@/components/ui/table";
import type { ViewComponent } from "@/model";
import { getActiveName, useViewerStore, useViewerStoreApi } from "@/store/viewer";
import { useViewer } from "./context";
import { BindingRow, HandlerRow, StateRow } from "./inspector-rows";

const ComponentContext = createContext<ViewComponent | null>(null);

export const useInspectorComponent = (): ViewComponent => {
  const component = useContext(ComponentContext);
  if (!component) throw new Error("useInspectorComponent must be used inside <Inspector>");
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

const Panel = ({ component, children }: { component: ViewComponent; children: ReactNode }) => {
  const isActive = useViewerStore((state) => getActiveName(state) === component.name);
  const setPanelOpen = useViewerStore((state) => state.setPanelOpen);
  return (
    <AccordionItem
      value={component.name}
      onOpenChange={(open) => setPanelOpen(component.name, open)}
      data-component={component.name}
      data-active={isActive || undefined}
      className="grid scroll-mt-4 gap-4 border-l-2 border-transparent pl-3 -ml-3 transition-colors duration-150 data-active:border-foreground/60"
    >
      <AccordionTrigger className="group flex w-full items-center gap-2 rounded-md text-left">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90" />
        <span className={isActive ? "font-medium text-foreground" : "font-medium text-text-2"}>
          {component.name}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <ComponentContext value={component}>
          <div className="grid gap-5 pb-2 pl-5">{children}</div>
        </ComponentContext>
      </AccordionContent>
    </AccordionItem>
  );
};

const isTopVisible = (element: Element, container: Element): boolean => {
  const box = element.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  return box.top >= bounds.top && box.top < bounds.bottom;
};

const useScrollActiveIntoView = (listRef: RefObject<HTMLDivElement | null>): void => {
  const store = useViewerStoreApi();
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        const list = listRef.current;
        const activeName = getActiveName(state);
        if (!list || activeName === null || activeName === getActiveName(previous)) return;
        if (list.matches(":hover")) return;
        const panel = list.querySelector(`[data-component="${CSS.escape(activeName)}"]`);
        if (panel && !isTopVisible(panel, list))
          panel.scrollIntoView({ block: "start", behavior: "smooth" });
      }),
    [store, listRef],
  );
};

const Root = ({ children }: { children: ReactNode }) => {
  const { view } = useViewer();
  const panels = useViewerStore((state) => state.panels);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollActiveIntoView(listRef);
  return (
    <Accordion
      ref={listRef}
      multiple
      value={view.components
        .filter((component) => panels.get(component.name))
        .map((component) => component.name)}
      className="grid h-full content-start gap-5 overflow-auto overscroll-none px-4 py-4 [scrollbar-gutter:stable] sm:px-5"
    >
      {view.components.map((component) => (
        <Panel key={component.name} component={component}>
          {children}
        </Panel>
      ))}
    </Accordion>
  );
};

const Variables = () => {
  const component = useInspectorComponent();
  return (
    <Section title="State variables" count={component.bindings.length}>
      {component.bindings.map((binding) => (
        <BindingRow key={binding.id} binding={binding} />
      ))}
    </Section>
  );
};

const States = () => {
  const component = useInspectorComponent();
  return (
    <Section title="States" count={component.states.length}>
      {component.states.map((state) => (
        <StateRow key={state.index} state={state} />
      ))}
    </Section>
  );
};

const Actions = () => {
  const component = useInspectorComponent();
  return (
    <Section title="Actions" count={component.handlers.length}>
      {component.handlers.map((handler) => (
        <HandlerRow key={handler.id} handler={handler} />
      ))}
    </Section>
  );
};

export const Inspector = Object.assign(Root, { Variables, States, Actions });
