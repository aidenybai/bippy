import { Component, createContext, type ReactNode } from "react";

const any = (): null => null;

const SizeContext = createContext("medium");

interface ThemeProviderProps {
  theme: string;
  children: ReactNode;
}

export class ThemeProvider extends Component<ThemeProviderProps> {
  static childContextTypes = { theme: any };

  getChildContext() {
    return { theme: this.props.theme };
  }

  render() {
    return this.props.children;
  }
}

interface LocaleProviderProps {
  locale: string;
  children: ReactNode;
}

export class LocaleProvider extends Component<LocaleProviderProps> {
  static childContextTypes = { locale: any };

  getChildContext() {
    return { locale: this.props.locale };
  }

  render() {
    return <section>{this.props.children}</section>;
  }
}

export class PassThrough extends Component<{ children: ReactNode }> {
  render() {
    return <div>{this.props.children}</div>;
  }
}

export class ThemedLabel extends Component {
  static contextTypes = { theme: any };

  render() {
    return <b className={this.context.theme}>theme:{this.context.theme}</b>;
  }
}

export class LocalizedLabel extends Component {
  static contextTypes = { theme: any, locale: any };

  render() {
    return (
      <i>
        {this.context.locale}/{this.context.theme}
      </i>
    );
  }
}

export class Unmasked extends Component {
  render() {
    return <em>context:{Object.keys(this.context).length === 0 ? "empty" : "leaked"}</em>;
  }
}

export class MissingKey extends Component {
  static contextTypes = { missing: any };

  render() {
    return <u>missing:{this.context.missing === undefined ? "absent" : "present"}</u>;
  }
}

export class Sized extends Component {
  static contextType = SizeContext;
  static contextTypes = { theme: any };

  render() {
    return <small>size:{this.context}</small>;
  }
}

interface FunctionLabelProps {
  prefix: string;
}

export const FunctionLabel = (props: FunctionLabelProps, context: { theme?: string }) => (
  <span>
    {props.prefix}:{context.theme}
  </span>
);
FunctionLabel.contextTypes = { theme: any };

export const App = () => (
  <ThemeProvider theme="dark">
    <PassThrough>
      <ThemedLabel />
      <Unmasked />
      <MissingKey />
      <FunctionLabel prefix="fn" />
      <SizeContext.Provider value="large">
        <Sized />
      </SizeContext.Provider>
      <LocaleProvider locale="en">
        <LocalizedLabel />
        <ThemeProvider theme="light">
          <LocalizedLabel />
        </ThemeProvider>
      </LocaleProvider>
    </PassThrough>
  </ThemeProvider>
);
