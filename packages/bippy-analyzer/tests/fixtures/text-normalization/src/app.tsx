const NAME = "world";
const COUNT = 3;
const BIG = 10n;

export const App = () => (
  <p>
    Hello, <strong>{NAME}</strong>!{`template ${NAME} ${COUNT}`}
    {COUNT} items
    {BIG}
    {"escaped \n newline"}
    &amp; entity &copy; multi line spaces
    <br />
    {" trailing "}
    {""}
    {`${""}`}
  </p>
);
