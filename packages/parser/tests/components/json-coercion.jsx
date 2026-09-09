/** `JSON.parse` stringifies its argument first: `null` parses as the literal `null`, `undefined` is a syntax error. */
const readToken = () => JSON.parse(localStorage.getItem("session"))?.token ?? "guest";

const parseMissing = () => {
  try {
    JSON.parse(undefined);
    return "parsed";
  } catch (caught) {
    return caught instanceof SyntaxError ? "syntax error" : "other error";
  }
};

export const isExact = true;

export default function JsonCoercion() {
  return (
    <dl>
      <dt>token</dt>
      <dd>
        {readToken()}
        <span />
      </dd>
      <dt>null</dt>
      <dd>
        {String(JSON.parse(null))}
        <span />
      </dd>
      <dt>number</dt>
      <dd>
        {JSON.parse(12) + 1}
        <span />
      </dd>
      <dt>missing</dt>
      <dd>
        {parseMissing()}
        <span />
      </dd>
    </dl>
  );
}
