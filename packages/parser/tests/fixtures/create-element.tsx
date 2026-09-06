import React, { createElement, cloneElement, Children, isValidElement, type ReactElement, type ReactNode } from "react";

const Item = ({ label, isActive }: { label: string; isActive?: boolean }) => (
  <li className={isActive ? "active" : undefined}>{label}</li>
);

const ActiveFirst = ({ children }: { children: ReactNode }) => (
  <ul>
    {Children.map(children, (child, index) =>
      isValidElement<{ isActive?: boolean }>(child) ? cloneElement(child, { isActive: index === 0 }) : child,
    )}
  </ul>
);

const Classic = () =>
  createElement(
    "div",
    { className: "classic" },
    createElement("span", null, "one"),
    React.createElement("span", { key: "two" }, "two"),
    "three",
  );

const Wrapped = ({ element }: { element: ReactElement<{ title?: string }> }) => <div>{cloneElement(element, { title: "wrapped" })}</div>;

export default function CreateElement() {
  return (
    <div>
      <ActiveFirst>
        <Item label="a" />
        <Item label="b" />
      </ActiveFirst>
      <Classic />
      <Wrapped element={<p>wrapped</p>} />
    </div>
  );
}
