export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    for (let outerIndex = 0; outerIndex < 3; outerIndex++) {
      for (let innerIndex = 0; innerIndex < 2; innerIndex++) {
        trace += `${outerIndex}${innerIndex}`;
        if (outerIndex === 1 && innerIndex === 0 && shouldThrow) throw "block";
      }
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
