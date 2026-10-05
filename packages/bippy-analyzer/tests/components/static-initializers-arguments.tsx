export default () => {
  let trace = "";
  const initialize = () => {
    trace += "F";
    throw "field";
  };
  const argument = () => {
    trace += "A";
  };
  let label = "returned";
  try {
    new (class {
      static value = initialize();
    })(argument());
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
