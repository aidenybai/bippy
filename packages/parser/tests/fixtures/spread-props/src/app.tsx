import type { ComponentProps, ReactNode } from "react";

const BASE = { className: "base", "data-kind": "spread" };

const Box = ({
  as: Tag = "div",
  children,
  ...rest
}: { as?: "div" | "span"; children?: ReactNode } & ComponentProps<"div">) => (
  <Tag {...rest}>{children}</Tag>
);

const Row = (props: { title: string; tags: string[] }) => {
  const { title, ...rest } = props;
  return (
    <tr title={title}>
      {rest.tags.map((tag) => (
        <td key={tag}>{tag}</td>
      ))}
    </tr>
  );
};

const ROWS = [
  { key: "r1", title: "first", tags: ["x"] },
  { key: "r2", title: "second", tags: ["y", "z"] },
];

export const App = () => (
  <table>
    <tbody>
      {ROWS.map((row) => (
        <Row {...row} />
      ))}
    </tbody>
    <caption>
      <Box {...BASE} id="override">
        boxed
      </Box>
      <Box as="span">span</Box>
    </caption>
  </table>
);
