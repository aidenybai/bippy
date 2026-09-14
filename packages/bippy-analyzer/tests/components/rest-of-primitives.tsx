interface CellProps {
  style?: { cursor: string };
  className?: string;
  title?: string;
}

/** react-table's `mergeProps`: user props may be `false` when a toggle is off. */
const mergeProps = (...propList: (CellProps | false)[]): CellProps =>
  propList.reduce<CellProps>((props, next) => {
    const { style, className, ...rest } = next || {};
    const merged = { ...props, ...rest };
    if (style) merged.style = merged.style ? { ...merged.style, ...style } : style;
    if (className)
      merged.className = merged.className ? `${merged.className} ${className}` : className;
    return merged;
  }, {});

const restOf = (value: boolean | number): string => {
  const { ...rest } = value;
  return `${Object.keys(rest).length}`;
};

const restOfString = (): string => {
  const { 0: first, ...rest } = "abc";
  return `${first}:${Object.keys(rest).join(",")}=${rest[1]}${rest[2]}`;
};

export default function RestOfPrimitives() {
  const isSorted = false;
  const headerProps = mergeProps({ className: "cell" }, isSorted && { title: "Toggle SortBy" });
  return (
    <table>
      <thead>
        <tr>
          <th {...headerProps}>name</th>
          <th data-rest={restOf(false)}>{restOf(42)}</th>
          <th>{restOfString()}</th>
        </tr>
      </thead>
    </table>
  );
}
