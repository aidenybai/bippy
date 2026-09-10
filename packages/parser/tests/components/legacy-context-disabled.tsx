import * as React from "react";

const any = (): null => null;

const Size = React.createContext("medium");

/** `disableLegacyContext`: `getChildContext` is never called and nothing reaches descendants. */
class ThemeProvider extends React.Component<{ children: React.ReactNode }> {
  static childContextTypes = { theme: any };

  getChildContext(): { theme: string } {
    return { theme: "dark" };
  }

  render(): React.ReactNode {
    return this.props.children;
  }
}

/** A class without `contextType` gets the empty context object. */
class ThemedLabel extends React.Component {
  static contextTypes = { theme: any };

  render(): React.ReactNode {
    return (
      <b>
        {"theme:"}
        {this.context.theme === undefined ? "undefined" : "leaked"}
        {"/"}
        {Object.keys(this.context).length}
      </b>
    );
  }
}

/** `contextType` reads the modern context regardless of `contextTypes`. */
class Sized extends React.Component {
  static contextType = Size;
  static contextTypes = { theme: any };

  render(): React.ReactNode {
    return (
      <small>
        {"size:"}
        {this.context}
      </small>
    );
  }
}

/** Function components receive no legacy context argument at all. */
const FunctionLabel = (props: { prefix: string }, context?: { theme?: string }) => (
  <span>
    {props.prefix}
    {":"}
    {context === undefined ? "no-context" : "context"}
  </span>
);
FunctionLabel.contextTypes = { theme: any };

export default function App() {
  return (
    <ThemeProvider>
      <ThemedLabel />
      <FunctionLabel prefix="fn" />
      <Size.Provider value="large">
        <Sized />
      </Size.Provider>
    </ThemeProvider>
  );
}
