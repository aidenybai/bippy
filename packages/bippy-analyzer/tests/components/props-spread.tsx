import type { HTMLAttributes, ReactNode } from "react";

interface BoxProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children?: ReactNode;
}

const Box = ({ title, children, ...rest }: BoxProps) => (
  <div {...rest}>
    {title ? <h6>{title}</h6> : null}
    {children}
  </div>
);

const Passthrough = (props: BoxProps) => <Box {...props} />;

const defaults = { title: "defaults", className: "d" };

const Merged = () => (
  <Box {...defaults} title="override">
    merged
  </Box>
);

const WithChildrenProp = () => <Box title="prop" children={<span>children prop</span>} />;

export default function PropsSpread() {
  return (
    <section>
      <Box title="plain">plain body</Box>
      <Passthrough title="pass">passthrough body</Passthrough>
      <Passthrough>no title</Passthrough>
      <Merged />
      <WithChildrenProp />
    </section>
  );
}
