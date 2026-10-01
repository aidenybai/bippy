import * as React from "react";

interface FieldProps {
  type?: string;
  label?: string;
}

/** A base component whose defaults live on the constructor, as `Component.defaultProps` does. */
class Field extends React.Component<FieldProps> {
  static defaultProps = { type: "text" };

  static handledProps = ["type", "label"];

  render() {
    const { type, label } = this.props;
    return (
      <div className={type}>
        {label ? <label>{label}</label> : null}
        {type ? <input type={type} /> : <output>no type</output>}
      </div>
    );
  }
}

/** `class Sub extends Base {}` inherits the statics through the constructor chain. */
class PasswordField extends Field {
  static Strength = () => <meter />;
}

class EmailField extends Field {
  static defaultProps = { type: "email", label: "email" };
}

const describeStatics = (component: typeof Field): string =>
  `${component.defaultProps.type}:${component.handledProps.length}`;

export default function App() {
  return (
    <form>
      <Field />
      <PasswordField />
      <PasswordField label="password" />
      <EmailField />
      <PasswordField.Strength />
      <p>{describeStatics(PasswordField)}</p>
      <p>{describeStatics(EmailField)}</p>
    </form>
  );
}

export const isExact = true;
