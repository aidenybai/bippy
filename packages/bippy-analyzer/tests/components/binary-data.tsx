const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const Row = ({ label, value }: { label: string; value: string | number | boolean }) => (
  <li>
    {label}: {String(value)}
  </li>
);

const TypedArrays = () => {
  const bytes = new Uint8Array(6);
  bytes.set([1, 2, 3], 1);
  bytes[5] = 255;
  const head = bytes.subarray(0, 4);
  const tail = bytes.slice(4);
  const doubled = Uint8Array.from(head, (byte) => byte * 2);
  const wide = new Uint16Array([1, 2, 3]);
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer, 2, 4);
  const words = new Uint16Array(new Uint8Array([1, 0, 0, 1]).buffer);
  return (
    <ul>
      <Row label="length" value={bytes.length} />
      <Row label="hex" value={toHex(bytes)} />
      <Row label="split" value={head.length + tail.length} />
      <Row label="doubled" value={Array.from(doubled).join(",")} />
      <Row label="of" value={Uint8Array.of(7, 8).byteLength} />
      <Row label="wide" value={wide.byteLength} />
      <Row label="buffer" value={buffer.byteLength} />
      <Row label="view" value={view.length} />
      <Row label="words" value={words.join(",")} />
      <Row label="instance" value={bytes instanceof Uint8Array} />
      <Row label="isView" value={ArrayBuffer.isView(bytes)} />
      <Row label="isView buffer" value={ArrayBuffer.isView(buffer)} />
      <Row label="backed" value={bytes.buffer instanceof ArrayBuffer} />
    </ul>
  );
};

const TextCodecs = () => {
  const encoded = new TextEncoder().encode("héllo");
  const decoded = new TextDecoder().decode(encoded);
  const utf16 = new TextDecoder("utf-16le").decode(new Uint8Array([104, 0, 105, 0]));
  return (
    <ul>
      <Row label="encoded" value={encoded.length} />
      <Row label="hex" value={toHex(encoded)} />
      <Row label="decoded" value={decoded} />
      <Row label="utf16" value={utf16} />
      <Row label="encoding" value={new TextEncoder().encoding} />
    </ul>
  );
};

export default function BinaryData() {
  return (
    <section>
      <TypedArrays />
      <TextCodecs />
    </section>
  );
}
