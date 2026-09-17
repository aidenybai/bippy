export default () => {
  const target = null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    throw new Error("key");
  };
  let label = "returned";
  try {
    const value = target![getKey()];
    void value;
  } catch (error) {
    label = error.message;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
