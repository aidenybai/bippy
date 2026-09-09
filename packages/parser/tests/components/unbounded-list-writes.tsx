const dynamicIndex = navigator.userAgent.length % 2;
const isWide = navigator.userAgent.includes("Chrome");

const slots = ["first", "second"];
slots[dynamicIndex] = "written";

const cells = ["head"];
if (isWide) cells.push("wide", "wide-tail");
else cells.push("narrow", "narrow-tail");

export const isPartial = true;

export default function UnboundedListWrites() {
  return (
    <ul>
      <li>{slots[0] === "written" ? <b>0</b> : <i>0</i>}</li>
      <li>{slots[1] === "written" ? <b>1</b> : <i>1</i>}</li>
      <li>{slots.includes("written") ? <strong>has written</strong> : <em>untouched</em>}</li>
      <li>{cells.length === 3 ? <strong>3</strong> : <em>{cells.length}</em>}</li>
      <li>{cells[2].endsWith("tail") ? <strong>tail</strong> : <em>no tail</em>}</li>
      {cells.map((cell) => (
        <li key={cell}>{cell.startsWith("wide") ? <b>{cell}</b> : <i>{cell}</i>}</li>
      ))}
    </ul>
  );
}
