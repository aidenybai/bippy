export default () => {
  const holder = () => "called";
  holder.value = "ready";
  const bound = holder.bind(null);
  return (
    <main>
      <span>Result:</span>
      {`${holder.value}:${typeof bound.value}:${"value" in bound}:${bound()}`}
    </main>
  );
};
