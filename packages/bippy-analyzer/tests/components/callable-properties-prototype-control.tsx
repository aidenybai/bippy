export default () => {
  const Holder = function () {};
  if (Math.random() > 0.5) Holder.prototype = { ready: true };
  return (
    <main>
      <span>Result:</span>
      {`${typeof Holder.prototype}:${"prototype" in Holder}`}
    </main>
  );
};
