import * as React from "react";

// react-autosuggest forwards `renderInputComponent={undefined}` to Autowhatever, whose
// `defaultProps` must still fill it in: React resolves defaults for every prop that is `undefined`.
// Function components go through `createElement`, which keeps resolving defaults in React 19.
interface FieldProps {
  renderInput?: (props: { name: string }) => React.ReactNode;
  label?: string;
  hint?: string | null;
}

const Field = ({ renderInput, label, hint }: FieldProps) => (
  <div>
    {renderInput?.({ name: "field" }) ?? <b>no input</b>}
    {label === undefined ? <b>no label</b> : <span>{label}</span>}
    {hint === null ? <i>null hint</i> : <em>{hint}</em>}
  </div>
);
Field.defaultProps = {
  renderInput: (props: { name: string }) => <input name={props.name} />,
  label: "default",
  hint: "default",
};

class Panel extends React.Component<{
  title?: string;
  hint?: string | null;
  children?: React.ReactNode;
}> {
  static defaultProps = { title: "panel", hint: "default" };

  render(): React.ReactNode {
    return (
      <section>
        {this.props.title === undefined ? <b>untitled</b> : <h2>{this.props.title}</h2>}
        {this.props.hint === null ? <i>null hint</i> : <em>{this.props.hint}</em>}
        {this.props.children}
      </section>
    );
  }
}

const Forwarder = (props: FieldProps) => React.createElement(Field, props);

export const isExact = true;

export default function App() {
  return (
    <>
      {React.createElement(Field, { renderInput: undefined, label: undefined, hint: null })}
      {React.createElement(Field, { label: "given" })}
      <Forwarder renderInput={undefined} />
      <Panel title={undefined} hint={null}>
        <p>child</p>
      </Panel>
    </>
  );
}
