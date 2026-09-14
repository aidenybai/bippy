import type { ReactNode } from "react";

export default () => {
  const values = Math.random() > 0.5 ? ["root"] : ["root", "child"];
  return values.reduceRight<ReactNode>(
    (children, value, index) => (
      <section key={value}>
        <span>{value}</span>
        {`${values.length}:${index}`}
        {children}
      </section>
    ),
    null,
  );
};
