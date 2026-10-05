export default () => {
  const values = Math.random() > 0.5 ? ["root"] : ["root", "child"];
  let calls = 0;
  const getArguments = () => {
    calls++;
    return values;
  };
  const combined = values.concat(getArguments());
  return (
    <main>
      <span>Calls and values:</span>
      {`${calls}:${combined.join(",")}`}
    </main>
  );
};
