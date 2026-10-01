export default () => {
  let trace = "";
  let selected = "old";
  const first = () => {
    trace += "F";
    throw "first";
  };
  const second = () => {
    trace += "S";
    return "new";
  };
  let label = "returned";
  try {
    selected = (first(), second());
    trace += "A";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}:${selected}`}
    </main>
  );
};
