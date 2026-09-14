export default () => {
  const target = undefined;
  const key = String(Math.random());
  let label = "returned";
  try {
    const value = target![key];
    void value;
  } catch (error) {
    label = `caught:${error.name}`;
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
