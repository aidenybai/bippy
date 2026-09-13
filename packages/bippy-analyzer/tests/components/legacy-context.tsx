import { Component, createContext, type ReactNode } from "react";

interface LegacyTheme {
  theme?: string;
}

const legacyShape = { theme: () => null };

class ThemeProvider extends Component<{ children: ReactNode }> {
  static childContextTypes = legacyShape;

  getChildContext(): LegacyTheme {
    return { theme: "legacy" };
  }

  render() {
    return <div>{this.props.children}</div>;
  }
}

class LegacyReader extends Component {
  static contextTypes = legacyShape;

  declare context: LegacyTheme;

  render() {
    const keys = Object.keys(this.context);
    return (
      <p>
        {this.context.theme === undefined ? (
          <em>no legacy context</em>
        ) : (
          <b>{this.context.theme}</b>
        )}
        <small>{keys.length}</small>
      </p>
    );
  }
}

const ModernTheme = createContext("modern");

class ModernReader extends Component {
  static contextType = ModernTheme;

  declare context: string;

  render() {
    return <output>{this.context === "modern" ? <i>modern</i> : <s>{this.context}</s>}</output>;
  }
}

export default function LegacyContext() {
  return (
    <ThemeProvider>
      <LegacyReader />
      <ModernReader />
    </ThemeProvider>
  );
}
