export default () => {
  let trace = "";
  let label = "returned";
  const update = () => {
    trace += "U";
    throw "update";
  };
  try {
    for (let index = 0; index < 1; index++, update()) {
      trace += "B";
      continue;
    }
    trace += "L";
  } catch (error) {
    label = String(error);
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
