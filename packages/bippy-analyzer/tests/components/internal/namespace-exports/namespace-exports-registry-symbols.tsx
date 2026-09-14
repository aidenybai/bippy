export default () => {
  const wellKnown = Symbol.toStringTag;
  const registered = Symbol.for("Symbol.toStringTag");
  const escaped = Symbol.for("\uE000registry:Symbol.toStringTag");
  const object = {
    [wellKnown]: "well-known",
    [registered]: "registered",
    [escaped]: "escaped",
  };
  const symbols = Object.getOwnPropertySymbols(object);
  return (
    <main>
      <span>Result:</span>
      {[
        registered === wellKnown ? "same" : "different",
        registered === Symbol.for("Symbol.toStringTag") ? "same" : "different",
        escaped === registered ? "same" : "different",
        object[wellKnown],
        object[registered],
        object[escaped],
        String(symbols.length),
        symbols[1]?.description ?? "missing",
      ].join(":")}
    </main>
  );
};
