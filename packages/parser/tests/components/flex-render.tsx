import { Component, type ComponentType, forwardRef, memo, type ReactNode } from "react";

interface CellProps {
  value: string;
}

/** react-table's `isClassComponent`: walks the constructor's prototype chain for `isReactComponent`. */
const isClassComponent = (component: unknown): boolean =>
  typeof component === "function" &&
  (() => {
    const proto = Object.getPrototypeOf(component);
    return proto.prototype && proto.prototype.isReactComponent;
  })();

const isExoticComponent = (component: unknown): boolean =>
  typeof component === "object" &&
  component !== null &&
  "$$typeof" in component &&
  typeof component.$$typeof === "symbol" &&
  ["react.memo", "react.forward_ref"].includes(component.$$typeof.description ?? "");

const isReactComponent = (component: unknown): component is ComponentType<CellProps> =>
  isClassComponent(component) || typeof component === "function" || isExoticComponent(component);

const flexRender = (Comp: unknown, props: CellProps): ReactNode =>
  isReactComponent(Comp) ? <Comp {...props} /> : String(Comp);

const DefaultCell = ({ value }: CellProps) => <span>{value}</span>;

class Legacy extends Component<CellProps> {
  render() {
    return <b>{this.props.value}</b>;
  }
}

const Exotic = memo(
  forwardRef<HTMLElement, CellProps>(({ value }, ref) => <i ref={ref}>{value}</i>),
);

const columns: { Header: unknown; Cell: unknown }[] = [
  { Header: "name", Cell: DefaultCell },
  { Header: "role", Cell: Legacy },
  { Header: "team", Cell: Exotic },
  { Header: 42, Cell: ({ value }: CellProps) => <em>{value}</em> },
];

export const isExact = true;

export default function FlexRender() {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={index}>{flexRender(column.Header, { value: "" })}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {columns.map((column, index) => (
            <td key={index}>{flexRender(column.Cell, { value: `cell ${index}` })}</td>
          ))}
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td>{String(Object.getPrototypeOf(DefaultCell).prototype)}</td>
          <td>{String(Object.getPrototypeOf(Legacy).prototype === Component.prototype)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
