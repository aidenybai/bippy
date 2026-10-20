import { useState } from "react";

export const ToolResult = ({ output, errorText }: { output?: string; errorText?: string }) => (
  <div>
    <h4>{errorText ? "Error" : "Result"}</h4>
    {errorText && <p>{errorText}</p>}
    <pre>{output}</pre>
  </div>
);

export const SignaturePad = () => {
  const [tab, setTab] = useState<string>("draw");
  return (
    <div>
      <input onChange={(event) => setTab(event.target.value)} />
      {tab === "draw" ? <canvas /> : null}
      {tab === "type" ? <input /> : null}
      {tab === "upload" ? <input type="file" /> : null}
    </div>
  );
};

export const LayoutBadge = ({ layout }: { layout: string }) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      {layout !== "legacy" ? <span>Modern</span> : null}
      {layout === "legacy" ? <span>Legacy</span> : null}
      <button onClick={() => setOpen(!isOpen)}>{isOpen ? "Hide" : "Show"}</button>
    </div>
  );
};
