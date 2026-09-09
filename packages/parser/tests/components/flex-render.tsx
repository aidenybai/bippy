import { type ComponentType, type ReactNode } from "react";

type Renderable<TProps> = ReactNode | ComponentType<TProps>;

const isClassComponent = (component: unknown): boolean =>
  typeof component === "function" &&
  (() => {
    const proto = Object.getPrototypeOf(component);
    return proto.prototype && proto.prototype.isReactComponent;
  })();

const isExoticComponent = (component: unknown): boolean =>
  typeof component === "object" &&
  component !== null &&
  typeof (component as { $$typeof?: unknown }).$$typeof === "symbol" &&
  ["react.memo", "react.forward_ref"].includes(
    (component as { $$typeof: symbol }).$$typeof.description ?? "",
  );

const isReactComponent = <TProps,>(component: unknown): component is ComponentType<TProps> =>
  isClassComponent(component) || typeof component === "function" || isExoticComponent(component);

const flexRender = <TProps extends object>(Comp: Renderable<TProps>, props: TProps): ReactNode =>
  !Comp ? null : isReactComponent<TProps>(Comp) ? <Comp {...props} /> : Comp;

interface CellProps {
  value: string;
}

const columns = [
  { id: "name", cell: ({ value }: CellProps) => <em>{value}</em> },
  { id: "plain", cell: "static text" },
  { id: "empty", cell: undefined },
];

export const isExact = true;

export default function FlexRenderTable() {
  return (
    <table>
      <tbody>
        <tr>
          {columns.map((column) => (
            <td key={column.id}>{flexRender(column.cell, { value: column.id })}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
