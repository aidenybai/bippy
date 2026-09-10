import type { ComponentType } from "react";

interface WidgetModule {
  title: string;
  default: ComponentType;
}

interface WidgetContext {
  (request: string): WidgetModule;
  keys: () => string[];
}

declare const require: {
  context: (directory: string, useSubdirectories?: boolean, regExp?: RegExp) => WidgetContext;
};

const topLevelWidgets = require.context("./widgets", false, /\.tsx$/);
const allWidgets = require.context("./widgets", true, /\.tsx$/);
const everyRequest = require.context("./widgets", true);

const describeMissing = (): string => {
  try {
    topLevelWidgets("./missing.tsx");
    return "found";
  } catch (error) {
    return error instanceof Error && "code" in error ? String(error.code) : "unexpected";
  }
};

export const App = () => (
  <main>
    <ul>
      {allWidgets.keys().map((key) => {
        const Widget = allWidgets(key).default;
        return (
          <li key={key}>
            <h2>
              {"# "}
              {allWidgets(key).title}
            </h2>
            <Widget />
          </li>
        );
      })}
    </ul>
    <code>
      {"= "}
      {topLevelWidgets.keys().join(" ")}
    </code>
    <code>
      {"= "}
      {everyRequest.keys().join(" ")}
    </code>
    <code>
      {"= "}
      {describeMissing()}
    </code>
  </main>
);
