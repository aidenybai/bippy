export default () => {
  const signed = { value: JSON.parse('"-0"') };
  const previous = signed.value++;
  const invalid = { value: JSON.parse('"invalid"') };
  const invalidNext = ++invalid.value;
  const infinite = { value: JSON.parse('"Infinity"') };
  const infinitePrevious = infinite.value--;
  return (
    <main>
      <span>Result:</span>
      {`${Object.is(previous, -0)}:${signed.value}|${Number.isNaN(invalidNext)}:${Number.isNaN(invalid.value)}|${infinitePrevious}:${infinite.value}`}
    </main>
  );
};
