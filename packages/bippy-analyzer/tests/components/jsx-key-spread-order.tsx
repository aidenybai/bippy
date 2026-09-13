const getRowProps = (index: number) => ({ key: `row_${index}`, role: "row" });

const getKeylessRowProps = (): { key?: string; role: string } => ({ key: undefined, role: "row" });

const rows = [0, 1];

export const isExact = true;

export default function JsxKeySpreadOrder() {
  return (
    <table>
      <thead>
        {rows.map((index) => (
          <tr key={index} {...getRowProps(index)}>
            <th>{index}</th>
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.map((index) => (
          <tr {...getRowProps(index)} key={index}>
            <td>{index}</td>
          </tr>
        ))}
        {rows.map((index) => (
          <tr {...getRowProps(index)}>
            <td>{index}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        {rows.map((index) => (
          <tr key={index} {...getKeylessRowProps()}>
            <td>{index}</td>
          </tr>
        ))}
      </tfoot>
    </table>
  );
}
