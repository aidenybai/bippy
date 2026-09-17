export default () => {
  const target = null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  const result = delete target?.[getKey()];
  return (
    <main>
      <span>Result:</span>
      {`${result}:${trace}`}
    </main>
  );
};
