export default () => {
  const evaluate = () => {
    const holder = () => {};
    if (Math.random() > 0.5) holder.value = "ready";
    return `${holder.value ?? "missing"}:${"value" in holder}:${holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
