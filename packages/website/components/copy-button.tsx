'use client';

import { useState } from 'react';

interface CopyButtonProps {
  content: string;
}

const DURATION = 2000;

export const CopyButton = ({ content }: CopyButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), DURATION);
  };

  return (
    <button
      onClick={handleCopy}
      className={`absolute right-0 top-0 rounded-[4px] border border-[#333333] bg-[#1a1a1a] px-1 py-[0.5px] text-sm ${isCopied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
    >
      {isCopied ? 'Copied!' : 'Copy'}
    </button>
  );
};
