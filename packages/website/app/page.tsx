import Image from 'next/image';
import { Github } from 'lucide-react';
import { readFile } from 'fs/promises';
import { join } from 'path';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlight } from '@/lib/shiki';
import { CopyButton } from '@/components/copy-button';

export const dynamic = 'force-static';
export const revalidate = false;

const NAV_LINK_CLASS =
  'text-neutral-400 hover:text-neutral-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 rounded-sm';

interface CodeBlockProps {
  children: string;
  className?: string;
}

const CodeBlock = async ({ children, className }: CodeBlockProps): Promise<React.JSX.Element> => {
  const language = className?.replace('language-', '') ?? 'bash';
  const code = children.trim();
  const html = await highlight(code, language);

  return (
    <div className="relative group max-w-full bg-neutral-900/80 border border-neutral-800/50 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 text-[12px] sm:text-[13px] font-[family-name:var(--font-geist-mono)] [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:bg-transparent! my-4">
      <CopyButton text={code} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

const processReadme = (content: string): string => {
  const lines = content.split('\n');
  const result: string[] = [];
  let isInWarningBlock = false;
  let isInBadgesBlock = false;

  for (const line of lines) {
    const isWarningStart = line.startsWith('> [!WARNING]') || line.startsWith('> ⚠️');
    const isBlockquoteLine = line.startsWith('>');
    const isTitleWithImage = line.startsWith('# <img');
    const isBadgeLine = line.startsWith('[![');
    const isEmpty = line.trim() === '';

    if (isWarningStart) {
      isInWarningBlock = true;
      continue;
    }

    if (isInWarningBlock) {
      if (!isBlockquoteLine) isInWarningBlock = false;
      else continue;
    }

    if (isTitleWithImage) continue;

    if (isBadgeLine) {
      isInBadgesBlock = true;
      continue;
    }

    if (isInBadgesBlock) {
      if (!isBadgeLine && !isEmpty) isInBadgesBlock = false;
      else continue;
    }

    result.push(line);
  }

  return result.join('\n');
};

const Page = async (): Promise<React.JSX.Element> => {
  const readmePath = join(process.cwd(), '..', 'bippy', 'README.md');
  const rawReadme = await readFile(readmePath, 'utf-8');
  const readme = processReadme(rawReadme);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-400">
      <main className="py-10 sm:py-16">
        <div className="max-w-[560px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-4">
            <a
              href="/"
              className="text-neutral-100 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 rounded-sm"
            >
              <h1>
                <div className="flex items-center gap-1.5">
                  <Image
                    src="/bippy.png"
                    alt="bippy"
                    width={24}
                    height={24}
                    className="rounded slam-hover"
                    unoptimized
                  />
                  <span className="font-medium">bippy</span>
                </div>
              </h1>
            </a>
            <nav className="flex items-center gap-2.5 sm:gap-4 text-[13px] sm:text-sm">
              <a href="#how-to-use" className={NAV_LINK_CLASS}>Install</a>
              <a href="#api-reference" className={NAV_LINK_CLASS}>API</a>
              <a
                href="https://github.com/aidenybai/bippy"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className={NAV_LINK_CLASS}
              >
                <Github className="w-3.5 h-3.5" />
              </a>
            </nav>
          </div>

          <article className="text-[14px] sm:text-[15px] space-y-4 [&>*:first-child]:mt-6">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => (
                  <h2
                    className="text-neutral-100 font-medium mt-12 mb-3 pt-8 border-t border-neutral-800 scroll-mt-8"
                    id={String(children).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')}
                    {...props}
                  >
                    {children}
                  </h2>
                ),
                h3: ({ children, ...props }) => (
                  <h3 className="text-neutral-200 font-medium mt-8 mb-2 text-[15px]" {...props}>
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-neutral-400 leading-relaxed my-3">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="text-neutral-400 my-4 space-y-2 text-[13px] sm:text-[14px] [&_ul]:my-1 [&_ul]:ml-4 [&_ul]:space-y-1">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="text-neutral-400 pl-4 relative before:content-['–'] before:absolute before:left-0 before:text-neutral-600 [&_p]:inline">
                    {children}
                  </li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-neutral-800 pl-4 text-neutral-500 text-[13px] my-4 [&_p]:my-1">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="border-neutral-800 my-10" />,
                strong: ({ children }) => (
                  <span className="text-neutral-100 font-medium">{children}</span>
                ),
                em: ({ children }) => (
                  <em className="text-neutral-400 not-italic">{children}</em>
                ),
                img: () => null,
                code: ({ children, className, ...props }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className="text-neutral-200 bg-neutral-800/60 px-1.5 py-0.5 rounded font-[family-name:var(--font-geist-mono)] text-[12px] sm:text-[13px]" {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <CodeBlock className={className}>
                      {String(children)}
                    </CodeBlock>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target={href?.startsWith('http') ? '_blank' : undefined}
                    rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className="text-neutral-300 hover:text-white transition-colors"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {readme}
            </Markdown>
          </article>

          <footer className="mt-10 sm:mt-16 pt-6 sm:pt-8 border-t border-neutral-800">
            <p className="text-sm text-neutral-500 flex items-center justify-between w-full">
              <span className="inline-flex items-center gap-1.5">
                Made by{' '}
                <a
                  href="https://x.com/aidenybai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-300 hover:text-white hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 rounded-sm"
                >
                  Aiden Bai
                </a>
              </span>
              <a
                href="https://github.com/aidenybai/bippy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-300 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 rounded-sm"
              >
                GitHub
              </a>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
};

export default Page;
