export default () => {
  const parent = {
    get value() {
      return "old";
    },
  };
  const child = Object.create(parent);
  let label = "returned";
  try {
    child.value = "new";
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${child.value}:${child.hasOwnProperty("value")}`}
    </main>
  );
};
