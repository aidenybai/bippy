export default () => {
  let trace = "";
  let label = "returned";
  try {
    for (let index = 0; index < 3; index++) {
      trace += index;
      if (index === 1) continue;
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
