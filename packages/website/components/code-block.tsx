import { highlight } from '@/lib/shiki';
import { CopyButton } from './copy-button';

interface CodeBlockProps {
  children: string;
  lang?: string;
}

export const CodeBlock = async ({
  children,
  lang = 'typescript',
}: CodeBlockProps) => {
  const html = await highlight(children, lang);

  return (
    <div className="group relative flex-1 overflow-x-auto">
      <CopyButton content={children} />
      <div
        className="[&_pre]:bg-transparent! [&_pre]:p-0! [&_code]:leading-relaxed [&_code]:text-sm [&_pre]:min-w-max"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
