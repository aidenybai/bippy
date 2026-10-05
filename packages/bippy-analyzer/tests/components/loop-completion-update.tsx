export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = Math.random() > 0.5;
  try {
    for (let index = 0; index < 3; trace += "U", index++) {
      trace += index;
      if (index === 1 && shouldThrow) throw "block";
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
