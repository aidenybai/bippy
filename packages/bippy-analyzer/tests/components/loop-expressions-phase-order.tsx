export default () => {
  let trace = "";
  let label = "returned";
  const update = () => {
    trace += "U";
    throw "update";
  };
  try {
    for (let index = 0; (trace += "T"), index < 2; index++, update()) {
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
