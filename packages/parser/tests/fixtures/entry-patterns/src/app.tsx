import React from "react";
import { Panel } from "./panel";

const theme = React.createContext("light");

const Themed = () => {
  const value = React.useContext(theme);
  return <em>{value}</em>;
};

const App = ({ title }: { title: string }) =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Panel, { title }),
    <theme.Provider value="dark">
      <Themed />
    </theme.Provider>,
  );

export default Object.assign(App, { version: "1.0.0" });
