export default () => {
  const target = undefined;
  const empty = undefined;
  let label = "returned";
  try {
    const kind = typeof target!.value;
    label = kind;
  } catch (error) {
    label = `caught:${error.name}`;
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${typeof empty}`}
    </main>
  );
};
