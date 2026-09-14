export default () => {
  const values = Math.random() > 0.5 ? ["root"] : ["root", "child"];
  return (
    <ol>
      {values.map((value, index) => (
        <li key={value}>
          <span>{value}</span>
          {`${values.length}:${index}`}
        </li>
      ))}
    </ol>
  );
};
