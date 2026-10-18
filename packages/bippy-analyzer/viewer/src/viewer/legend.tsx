import type { ReactNode } from "react";
import { Table, TableBody } from "@/components/ui/table";
import { useLoadedComponent } from "./context";
import { BindingRow, HandlerRow, StateRow } from "./legend-rows";

interface SectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

const Section = ({ title, count, children }: SectionProps) => (
  <section className="grid gap-2">
    <header className="flex items-center gap-3">
      <h2 className="font-medium text-text-2">{title}</h2>
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

const Root = ({ children }: { children: ReactNode }) => (
  <div className="grid h-full content-start gap-6 overflow-auto overscroll-none px-4 py-4 sm:px-5">
    {children}
  </div>
);

const Title = () => {
  const component = useLoadedComponent();
  return <h1 className="font-medium text-text-2">{component.name}</h1>;
};

const Variables = () => {
  const component = useLoadedComponent();
  return (
    <Section title="State variables" count={component.bindings.length}>
      {component.bindings.map((binding) => (
        <BindingRow key={binding.id} binding={binding} />
      ))}
    </Section>
  );
};

const States = () => {
  const component = useLoadedComponent();
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
  const component = useLoadedComponent();
  return (
    <Section title="Actions" count={component.handlers.length}>
      {component.handlers.map((handler) => (
        <HandlerRow key={handler.id} handler={handler} />
      ))}
    </Section>
  );
};

export const Legend = Object.assign(Root, { Title, Variables, States, Actions });
