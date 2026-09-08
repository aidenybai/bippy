import { Component, memo, forwardRef } from "react";
import type { ReactNode } from "react";

const withLabel = <Props extends object>(
  Wrapped: (props: Props) => ReactNode,
): ((props: Props) => ReactNode) => Wrapped;

const Panel = withLabel(function Panel({ children }: { children?: ReactNode }) {
  return <section>{children}</section>;
});

export const Badge = memo(function Badge({ children }: { children?: ReactNode }) {
  return <b>{children}</b>;
});

const Field = forwardRef<HTMLInputElement, { name: string }>(function Field({ name }, ref) {
  return <input ref={ref} name={name} />;
});

const Card = withLabel(
  class Card extends Component<{ children?: ReactNode }> {
    render() {
      return <article>{this.props.children}</article>;
    }
  },
);

const Row = withLabel(function Row() {
  const Row = withLabel(function Row() {
    return <i>inner</i>;
  });
  return (
    <li>
      <Row />
    </li>
  );
});

export const Cell = ({ children }: { children?: ReactNode }) => <td>{children}</td>;
const TableCell = Cell;

const Table = withLabel(function Cell() {
  return (
    <table>
      <tbody>
        <tr>
          <TableCell>cell</TableCell>
        </tr>
      </tbody>
    </table>
  );
});

const Plain = withLabel(function PlainContent() {
  return <u>plain</u>;
});

const Kind = "outer";
const Shadow = withLabel(function Kind() {
  return typeof Kind === "function" ? <em>self</em> : <s>outer</s>;
});

const App = () => (
  <Panel>
    <Badge>badge</Badge>
    <Field name="field" />
    <Card>card</Card>
    <ul>
      <Row />
    </ul>
    <Table />
    <Plain />
    <Shadow />
    <i>{Kind}</i>
  </Panel>
);

export default App;
