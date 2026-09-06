import type { ComponentType, ReactNode } from "react";

const IconA = () => (
  <svg>
    <title>A</title>
    <path d="M0" />
  </svg>
);
const IconB = () => (
  <svg>
    <title>B</title>
    <circle r="1" />
  </svg>
);

const ICONS: Record<string, ComponentType> = { a: IconA, b: IconB };

const Icon = ({ name }: { name: string }) => {
  const Component = ICONS[name];
  return Component ? <Component /> : null;
};

const Heading = ({ level, children }: { level: 1 | 2 | 3; children: ReactNode }) => {
  const Tag = `h${level}` as const;
  return <Tag>{children}</Tag>;
};

const Box = ({ as: As = "div", children }: { as?: "div" | "section"; children: ReactNode }) => (
  <As>{children}</As>
);

const Polymorphic = ({ isLink }: { isLink: boolean }) => {
  const Element = isLink ? "a" : "button";
  return <Element>{isLink ? "link" : "button"}</Element>;
};

export default function DynamicTypes() {
  return (
    <div>
      <Icon name="a" />
      <Icon name="b" />
      <Icon name="missing" />
      <Heading level={2}>heading</Heading>
      <Box>default box</Box>
      <Box as="section">section box</Box>
      <Polymorphic isLink />
      <Polymorphic isLink={false} />
    </div>
  );
}
