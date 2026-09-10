import React from "react";
import { getWidget } from "./registry";

const theme = React.createContext("light");

const Themed = () => {
  const value = React.useContext(theme);
  return <em>{value}</em>;
};

const App = ({ title }: { title: string }) => {
  const Widget = getWidget("panel");
  if (!Widget) throw new Error("Widget not found: panel");
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Widget, { title }),
    <theme.Provider value="dark">
      <Themed />
    </theme.Provider>,
  );
};

export default Object.assign(App, { version: "1.0.0" });
