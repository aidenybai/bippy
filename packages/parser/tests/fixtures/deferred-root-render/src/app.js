const Row = ({ index }) => (
  <tr>
    <td>{`row ${index}`}</td>
  </tr>
);

export const App = ({ rows }) => {
  const items = [];
  for (let index = 0; index < rows; index++) items.push(<Row key={index} index={index} />);
  return (
    <>
      <h2 className="title">JSX in .js</h2>
      <table>
        <tbody>{items}</tbody>
      </table>
    </>
  );
};
