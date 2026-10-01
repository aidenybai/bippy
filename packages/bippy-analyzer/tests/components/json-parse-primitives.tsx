// `JSON.parse` stringifies its argument first: an absent inline-script global
// parses as the text "undefined" and throws, which `try`/`catch` config
// readers turn into their default, while `null`, numbers and booleans parse
// as their own JSON.

const inlineShareInfo: string | undefined = undefined;

const readShareInfo = (): { id: string } | null => {
  try {
    return JSON.parse(inlineShareInfo!);
  } catch {
    return null;
  }
};

const parseLoose = (value?: unknown): string => {
  try {
    return String(JSON.parse(value as string));
  } catch (error) {
    return error instanceof SyntaxError ? "syntax-error" : "unexpected";
  }
};

export default function JsonParsePrimitives() {
  const shareInfo = readShareInfo();
  return (
    <ul>
      <li>{shareInfo === null ? "no share" : shareInfo.id}</li>
      <li>{parseLoose(undefined)}</li>
      <li>{parseLoose(null)}</li>
      <li>{parseLoose(42)}</li>
      <li>{parseLoose(true)}</li>
      <li>{parseLoose('"text"')}</li>
      <li>{parseLoose("{bad")}</li>
      <li>{parseLoose()}</li>
    </ul>
  );
}

export const isExact = true;
