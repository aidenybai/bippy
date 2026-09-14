export default () => {
  let trace = "";
  const parent = () => {
    trace += "H";
    throw "parent";
  };
  const argument = () => {
    trace += "A";
    return "argument";
  };
  let label = "returned";
  try {
    new (class extends parent() {})(argument());
    trace += "C";
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
