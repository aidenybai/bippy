export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  const update = () => {
    trace += "U";
    if (shouldThrow) throw "update";
  };
  try {
    for (let index = 0; index < 2; index++, update()) {
      trace += "B";
    }
    trace += "L";
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
