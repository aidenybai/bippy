import { Component, PureComponent } from "react";
import type { ComponentType, ReactNode } from "react";

class Base {
  label = "base";
}

class Derived extends Base {}

class ClassWidget extends Component<{ children?: ReactNode }> {
  render() {
    return <b>{this.props.children}</b>;
  }
}

class PureWidget extends PureComponent {
  render() {
    return <u>pure</u>;
  }
}

const FunctionWidget = ({ children }: { children?: ReactNode }) => <i>{children}</i>;

const isClassComponent = (component: ComponentType<never>): boolean =>
  Object.prototype.isPrototypeOf.call(Component, component) ||
  Object.prototype.isPrototypeOf.call(PureComponent, component);

const Marker = ({ isOnChain }: { isOnChain: boolean }) => (isOnChain ? <b>yes</b> : <i>no</i>);

const isOnPrototypeChain = (prototype: object, value: unknown): boolean =>
  Object.prototype.isPrototypeOf.call(prototype, value);

const shapes = [
  Base.isPrototypeOf(Derived),
  Derived.isPrototypeOf(Base),
  Base.prototype.isPrototypeOf(new Derived()),
  Base.prototype.isPrototypeOf(new Base()),
  Derived.prototype.isPrototypeOf(new Base()),
  isOnPrototypeChain(Object.prototype, FunctionWidget),
  isOnPrototypeChain(Function.prototype, ClassWidget),
  isOnPrototypeChain(Array.prototype, [1]),
  isOnPrototypeChain(Array.prototype, {}),
  isOnPrototypeChain(Object.prototype, "text"),
  Component.isPrototypeOf(PureWidget),
];

export default function PrototypeChain() {
  return (
    <section>
      <Marker isOnChain={isClassComponent(ClassWidget)} />
      <Marker isOnChain={isClassComponent(PureWidget)} />
      <Marker isOnChain={isClassComponent(FunctionWidget)} />
      {shapes.map((isOnChain, index) => (
        <Marker key={index} isOnChain={isOnChain} />
      ))}
      <ul>
        {Array.from({ length: shapes.filter(Boolean).length }, (_, index) => (
          <li key={index} />
        ))}
      </ul>
    </section>
  );
}
