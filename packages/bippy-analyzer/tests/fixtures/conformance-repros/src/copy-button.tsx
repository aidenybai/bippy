import { useState } from "react";

const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text);

export const CopyButton = ({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false);
  const handleCopy = async () => {
    await copyText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };
  return (
    <button type="button" onClick={handleCopy}>
      {isCopied ? "Copied" : "Copy"}
    </button>
  );
};
