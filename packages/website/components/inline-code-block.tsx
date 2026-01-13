interface InlineCodeBlockProps {
  children: React.ReactNode;
}

export const InlineCodeBlock = ({ children }: InlineCodeBlockProps) => {
  return (
    <code className="whitespace-pre-wrap wrap-break-word rounded-[4px] border border-[#333333] bg-[#1a1a1a] px-1 py-[0.5px] text-base">
      {children}
    </code>
  );
};
