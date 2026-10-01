export default () => {
  const inherited = Object.create({ value: 1 });
  const results = [
    Object.hasOwn({ value: undefined }, "value"),
    Object.hasOwn({}, "missing"),
    Object.hasOwn("ab", "0"),
    Object.hasOwn("ab", "length"),
    Object.hasOwn(7, "toString"),
    Object.hasOwn({ undefined: 1 }),
    Object.hasOwn(inherited, "value"),
  ];
  return (
    <main>
      <span>Result:</span>
      {results.map((value) => (value ? "yes" : "no")).join(":")}
    </main>
  );
};
