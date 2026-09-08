import React, { type ReactNode } from "react";

interface ItemProps {
  label: string;
  isActive?: boolean;
}

const Item = ({ label, isActive = false }: ItemProps) => (
  <li className={isActive ? "active" : undefined}>{label}</li>
);

interface MenuProps {
  children: ReactNode;
  activeIndex: number;
}

const Menu = ({ children, activeIndex }: MenuProps) => {
  const items = React.Children.map(children, (child, index) =>
    React.isValidElement<ItemProps>(child) && index === activeIndex
      ? React.cloneElement(child, { isActive: true })
      : child,
  );
  return <ul>{items}</ul>;
};

const Fanned = ({ children }: { children: ReactNode }) => (
  <ol>{React.Children.map(children, (child) => [child, <li>copy</li>])}</ol>
);

const Counted = ({ children }: { children: ReactNode }) => {
  const labels: string[] = [];
  const collector = { prefix: "item:", labels };
  React.Children.forEach(
    children,
    function (this: typeof collector, child, index) {
      if (typeof child === "string") this.labels.push(`${this.prefix}${child}@${index}`);
    },
    collector,
  );
  return (
    <p>
      {React.Children.count(children)} children, {React.Children.toArray(children).length} kept,{" "}
      {labels.join(" ")}
    </p>
  );
};

const Keyed = ({ children }: { children: ReactNode }) => (
  <section>
    {React.Children.toArray(children).map((child) =>
      React.isValidElement(child) ? <span data-key={String(child.key)}>{child}</span> : child,
    )}
  </section>
);

const Ordered = ({ children }: { children: ReactNode }) => (
  <div>{React.Children.toArray(children).reverse()}</div>
);

const resources = ["posts", "comments", "tags"];

const App = () => (
  <main>
    <Menu activeIndex={1}>
      {false}
      {resources.map((name) => (
        <Item key={name} label={name} />
      ))}
    </Menu>
    <Fanned>
      <li key="a">a</li>
      <li>b</li>
      {["c", "d"]}
    </Fanned>
    <Counted>
      {null}
      {"x"}
      {[true, "y", [undefined, "z"]]}
      {0}
    </Counted>
    <Keyed>
      <em key="first">first</em>
      <em key="with/slash">slash</em>
      <em key="with:colon">colon</em>
      <em>plain</em>
      {[<em key="nested">nested</em>, <em>anon</em>]}
    </Keyed>
    <Ordered>
      <b>1</b>
      {[<b key="two">2</b>, <b>3</b>]}
      <b>4</b>
    </Ordered>
  </main>
);

export default App;
