export default () => {
  let trace = "";
  const key = () => {
    trace += "K";
    throw "key";
  };
  const argument = () => {
    trace += "A";
  };
  let label = "returned";
  try {
    new (class {
      [key()]() {}
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
