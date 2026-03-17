import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
}

export const CopyButton = ({ text }: CopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 rounded p-1.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-accent/50"
      aria-label="Copy code"
    >
      <Icon className="size-4 text-muted-foreground" />
    </button>
  );
};
