export const CountedList = ({ items, count }: { items: string[]; count: number }) => (
  <div>
    {items.length > 0 ? (
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    ) : null}
    {items.length ? <p>Has items</p> : <p>Empty</p>}
    {count > 0 && <b>{count}</b>}
    {!count && <i>None</i>}
  </div>
);
