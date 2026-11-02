import type { ReactNode } from "react";

export const PriceTag = ({ price }: { price: string | number | null }) => (
  <p>
    {typeof price === "string" ? <b>{price}</b> : null}
    {typeof price === "number" ? <i>{price.toFixed(2)}</i> : null}
    {price === null ? <s>Free</s> : null}
  </p>
);

export const Slot = ({ render }: { render: ReactNode | (() => ReactNode) }) => (
  <div>{typeof render === "function" ? render() : render}</div>
);
