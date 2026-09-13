import { useState } from "react";

const PdfSlot = () => {
  const [pdf] = useState(() => new Blob());
  return pdf.size === 0 ? <em>no document yet</em> : <iframe title="document" />;
};

const TextBlob = () => {
  const csv = new Blob(["id,name\n", "1,Ada\n"], { type: "text/CSV" });
  const nested = new Blob([csv, "2,Grace\n"]);
  return (
    <ul>
      <li>{csv.size}</li>
      <li>{csv.type}</li>
      <li>{nested.size}</li>
      <li>{nested.type === "" ? "untyped" : nested.type}</li>
      {csv instanceof Blob && <li>blob</li>}
      <li>{new Blob(["héllo"]).size}</li>
    </ul>
  );
};

export default function Blobs() {
  return (
    <section>
      <PdfSlot />
      <TextBlob />
    </section>
  );
}
