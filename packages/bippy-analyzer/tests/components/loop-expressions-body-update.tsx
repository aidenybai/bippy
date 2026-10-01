export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrowBody = Math.random() > 0.5;
  const shouldThrowUpdate = Math.random() > 0.5;
  const update = () => {
    trace += "U";
    if (shouldThrowUpdate) throw "update";
  };
  try {
    for (let index = 0; index < 1; index++, update()) {
      trace += "B";
      if (shouldThrowBody) throw "body";
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
