import { Component } from "react";

interface Breakpoint {
  breakpoint: number;
  label: string;
}

interface ResponsiveProps {
  responsive?: Breakpoint[];
  children?: string;
}

interface ResponsiveState {
  breakpoint: number | null;
}

const defaults = { arrow: null as string | null, label: "wide" };

class Responsive extends Component<ResponsiveProps, ResponsiveState> {
  state: ResponsiveState = { breakpoint: null };

  handlers: Array<() => void> = [];

  componentDidMount() {
    if (this.props.responsive) {
      for (const entry of this.props.responsive) {
        const handler = () => this.setState({ breakpoint: entry.breakpoint });
        this.handlers.push(handler);
        window.matchMedia(`(max-width: ${entry.breakpoint}px)`).addEventListener("change", handler);
      }
    }
  }

  render() {
    let settings: { arrow: string | null; label: string };
    if (this.state.breakpoint) {
      const matched = this.props.responsive?.filter(
        (entry) => entry.breakpoint === this.state.breakpoint,
      );
      settings = { ...defaults, label: matched?.[0]?.label ?? "narrow" };
    } else {
      settings = { ...defaults };
    }
    return (
      <section>
        {settings.arrow ? <button>{settings.arrow}</button> : <span>{settings.label}</span>}
        <p>{this.props.children}</p>
      </section>
    );
  }
}

export const isExact = true;

export default function ClassGuardedMountState() {
  return <Responsive>fixed layout</Responsive>;
}
