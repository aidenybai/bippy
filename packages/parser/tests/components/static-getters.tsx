import { Component, type ReactNode } from "react";

class Registry {
  static entries: string[] = [];
  static label = "base";

  static get size(): number {
    return Registry.entries.length;
  }

  static get description(): string {
    return `${this.label}:${this.size}`;
  }

  static register(entry: string): void {
    Registry.entries.push(entry);
  }
}

class NamedRegistry extends Registry {
  static label = "named";
}

const readSize = (): number => Registry.size;

const sizeBefore = readSize();
Registry.register("alpha");
Registry.register("beta");
const sizeAfter = readSize();
const hasSize = "size" in Registry;
const ownKeys = Object.keys(Registry).join(",");

interface GreetingProps {
  greeting?: string;
  name: string;
}

class Greeting extends Component<GreetingProps> {
  static get defaultProps(): Partial<GreetingProps> {
    return { greeting: `hello #${Registry.size}` };
  }

  render(): ReactNode {
    return (
      <p>
        {this.props.greeting}, {this.props.name}
      </p>
    );
  }
}

export const isExact = true;

export default function StaticGetters() {
  return (
    <section>
      <Greeting name="ada" />
      <Greeting greeting="hi" name="grace" />
      <ul>
        <li>sizes: {`${sizeBefore}->${sizeAfter}`}</li>
        <li>descriptions: {`${Registry.description}|${NamedRegistry.description}`}</li>
        <li>keys: {`${String(hasSize)}|${ownKeys}`}</li>
      </ul>
    </section>
  );
}
