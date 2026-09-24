export default () => {
  let trace = "";
  let label = "returned";
  const shouldThrow = false;
  try {
    for (let index = 0; index < 3; index++) {
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
