export default () => {
  const target = {
    get value() {
      return "old";
    },
  };
  let label = "returned";
  try {
    class Writer extends ((target.value = "new"), Object) {}
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
