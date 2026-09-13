import type { ComponentType } from "react";

interface WidgetModule {
  title: string;
  default: ComponentType;
}

const widgets = import.meta.glob<WidgetModule>(
  ["./shared/widgets/*.tsx", "!./shared/widgets/*.test-helper.tsx"],
  { eager: true },
);
const widgetComponents = import.meta.glob<ComponentType>("./shared/widgets/*.tsx", {
  eager: true,
  import: "default",
});
const widgetSources = import.meta.glob<string>("./shared/widgets/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const lazyWidgets = import.meta.glob<WidgetModule>("./shared/widgets/*.tsx");

const widgetKeys = Object.keys(widgets);
const Gamma = widgetComponents["./shared/widgets/gamma.test-helper.tsx"];

export default function ImportGlob() {
  return (
    <main>
      <ul>
        {widgetKeys.map((key) => {
          const Widget = widgets[key].default;
          return (
            <li key={key}>
              <h2>{widgets[key].title}</h2>
              <Widget />
            </li>
          );
        })}
      </ul>
      {Gamma ? <Gamma /> : <strong />}
      {widgetKeys.length === 2 ? <em /> : <strong />}
      {widgetKeys[0] === "./shared/widgets/alpha.tsx" ? <em /> : <strong />}
      {Object.keys(widgetComponents).length === 3 ? <em /> : <strong />}
      {widgetSources["./shared/widgets/beta.tsx"].includes("Beta") ? <em /> : <strong />}
      {typeof lazyWidgets["./shared/widgets/alpha.tsx"] === "function" ? <em /> : <strong />}
    </main>
  );
}
