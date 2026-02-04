'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
}

export const CopyButton = ({ text }: CopyButtonProps): React.JSX.Element => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const Icon = copied ? Check : Copy;

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-neutral-700/50"
      aria-label="Copy code"
    >
      <Icon className="w-4 h-4 text-white" />
    </button>
  );
};
