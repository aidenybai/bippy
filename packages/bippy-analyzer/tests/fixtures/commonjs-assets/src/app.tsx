declare const require: (specifier: string) => string & Record<string, string>;

const logo = require("@assets/logo.png");
const tokens = require("./tokens.module.css");

export const App = () => (
  <header className={tokens.frame}>
    {logo ? <img src={logo} alt="titlebar icon" /> : ""}
    <h1>{tokens.brand}</h1>
  </header>
);
