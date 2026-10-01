const hidden = Symbol("hidden");
const registry: Record<string | symbol, () => string> = {
  "@@initialState": () => "initial",
  [`@@${"iterator"}`]: () => "iterator",
  [hidden]: () => "symbol-keyed",
};

const SymbolLikeStringKeys = () => (
  <ul>
    {Object.keys(registry).map((key) => (
      <li key={key}>
        {key}={registry[key]()}
      </li>
    ))}
    <li>{Object.getOwnPropertySymbols(registry).length} symbol</li>
    <li>{registry[hidden]()}</li>
    <li>{JSON.stringify(Object.entries(registry).map(([key]) => key))}</li>
  </ul>
);

export default SymbolLikeStringKeys;
