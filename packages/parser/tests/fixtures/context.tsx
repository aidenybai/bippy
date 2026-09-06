import { createContext, type ReactNode, use, useContext } from "react";

interface Theme {
  mode: "light" | "dark";
  accent: string;
}

const ThemeContext = createContext<Theme>({ mode: "light", accent: "blue" });
const CountContext = createContext(0);

const ThemedBox = () => {
  const theme = useContext(ThemeContext);
  return <div className={theme.mode}>{theme.mode === "dark" ? <span>dark</span> : <span>light</span>}</div>;
};

const CountReader = () => {
  const count = use(CountContext);
  return <output>{count > 0 ? <b>{count}</b> : <i>zero</i>}</output>;
};

const ConsumerBox = () => (
  <ThemeContext.Consumer>{(theme) => <p className={theme.accent}>{theme.accent}</p>}</ThemeContext.Consumer>
);

const Provider = ({ children }: { children: ReactNode }) => (
  <ThemeContext.Provider value={{ mode: "dark", accent: "red" }}>{children}</ThemeContext.Provider>
);

export default function Context() {
  return (
    <div>
      <ThemedBox />
      <Provider>
        <ThemedBox />
        <ConsumerBox />
      </Provider>
      <ThemeContext value={{ mode: "light", accent: "green" }}>
        <ConsumerBox />
      </ThemeContext>
      <CountReader />
      <CountContext value={3}>
        <CountReader />
      </CountContext>
    </div>
  );
}
