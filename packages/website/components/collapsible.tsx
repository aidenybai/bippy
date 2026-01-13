'use client';

import { useState, type ReactNode } from 'react';

interface CollapsibleProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}

export const Collapsible = ({
  title,
  children,
  defaultOpen = true,
  id,
}: CollapsibleProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-4 mt-8" id={id}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-base font-semibold text-left cursor-pointer"
      >
        <span className="text-sm text-[#888]">{isOpen ? '▾' : '▸'}</span> {title}
      </button>
      {isOpen && children}
    </div>
  );
};
