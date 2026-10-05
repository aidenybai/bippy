export default () => {
  const useFirst = Math.random() > 0.5;
  let value = useFirst ? 1n : 4n;
  const previous = value++;
  const next = --value;
  return (
    <main>
      <span>Result:</span>
      {`${useFirst ? "first" : "later"}:${typeof previous}:${previous}:${typeof next}:${next}:${value}`}
    </main>
  );
};
