import { PureComponent } from "react";

window.Loader = class extends PureComponent {
  static displayName = "Loader";

  render() {
    return <div className="loader">{this.props.label ?? "loading"}</div>;
  }
};

window.Panel = ({ title, children }) => (
  <section>
    <h3>{title}</h3>
    {children}
  </section>
);

window.PANEL_TITLE = "Globals";
