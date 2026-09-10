import { type FunctionComponent, memo, useState } from "react";

let renderCount = 0;

const useRenderTracking = <Result,>(name: string, render: () => Result): Result => {
  const [label] = useState(() => `tracked(${name})`);
  renderCount++;
  const result = render();
  return typeof result === "object" && result !== null ? result : label;
};

const trackingHandlers: ProxyHandler<FunctionComponent<{ title: string }>> = {
  apply(Component, thisArg, argumentsList) {
    return useRenderTracking(Component.displayName ?? Component.name ?? "tracked(???)", () =>
      Component.apply(thisArg, argumentsList),
    );
  },
};

const track = (baseComponent: FunctionComponent<{ title: string }>) =>
  memo(new Proxy(baseComponent, trackingHandlers));

const Panel = track(function Panel({ title }: { title: string }) {
  const [count] = useState(2);
  return (
    <section>
      <h2>{title}</h2>
      <p>{count} tracked renders</p>
    </section>
  );
});

const Untrapped = new Proxy(function Untrapped({ title }: { title: string }) {
  return <em>{title}</em>;
}, {});

export const isExact = true;

export default function ProxiedComponent() {
  return (
    <main data-renders={renderCount}>
      <Panel title="signals" />
      <Untrapped title="plain" />
    </main>
  );
}
