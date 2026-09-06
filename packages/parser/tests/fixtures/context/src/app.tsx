import { useContext } from "react";
import { DensityContext, ThemeContext } from "./theme";

const ThemedButton = () => {
  const theme = useContext(ThemeContext);
  const density = useContext(DensityContext);
  return <button className={`btn-${theme.name} ${density}`}>{theme.accent}</button>;
};

const Consumerish = () => (
  <ThemeContext.Consumer>{(theme) => <em>{theme.name}</em>}</ThemeContext.Consumer>
);

export const App = () => (
  <ThemeContext.Provider value={{ name: "dark", accent: "purple" }}>
    <ThemedButton />
    <DensityContext value="compact">
      <ThemedButton />
      <Consumerish />
    </DensityContext>
    <ThemedButton />
  </ThemeContext.Provider>
);
