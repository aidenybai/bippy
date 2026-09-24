import { cloneElement, type ReactElement, type ReactNode } from "react";

const messages = ["first", "second", "third"];

function Keyed({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <span>{label}</span>
      {children}
    </li>
  );
}

function Unkeyed({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

function Presence({ children }: { children: ReactElement[] }) {
  return (
    <ul>
      {children.map((child, index) =>
        child.key ? (
          <Keyed key={child.key} label={typeof child.key}>
            {child}
          </Keyed>
        ) : (
          <Unkeyed key={index}>{child}</Unkeyed>
        ),
      )}
    </ul>
  );
}

export default function ElementKeys() {
  const cloned = cloneElement(<p>cloned</p>, { key: 7 });
  const keyless = <p key={undefined}>keyless</p>;
  return (
    <Presence>
      {[
        ...messages.map((message, index) => <p key={index}>{message}</p>),
        cloned,
        keyless,
        <p key={false}>{String(cloned.key === "7")}</p>,
      ]}
    </Presence>
  );
}
