import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "@/lib/shiki";
import { CopyButton } from "@/components/copy-button";
import { SiteProvider } from "@/providers/site-provider";
import { ProjectInfo } from "@/components/project-info";
import { CommandDisplay } from "@/components/command-display";
import { ActionButtons } from "@/components/action-buttons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import readmeRaw from "../../bippy/README.md?raw";

const GITHUB_URL = "https://github.com/aidenybai/bippy";

interface CodeBlockProps {
  children: string;
  className?: string;
}

const CodeBlock = ({ children, className }: CodeBlockProps) => {
  const language = className?.replace("language-", "") ?? "bash";
  const code = children.trim();
  const [html, setHtml] = useState("");

  useEffect(() => {
    highlight(code, language).then(setHtml);
  }, [code, language]);

  return (
    <div className="group relative my-4 max-w-full overflow-hidden rounded-xs border bg-muted px-3 py-2.5 font-mono text-xs dark:bg-background sm:px-4 sm:py-3 sm:text-[13px] [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:bg-transparent!">
      <CopyButton text={code} />
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="bg-transparent p-0 whitespace-pre-wrap break-words">
          <code className="bg-transparent">{code}</code>
        </pre>
      )}
    </div>
  );
};

const processReadme = (content: string): string => {
  const lines = content.split("\n");

  const firstHeadingIndex = lines.findIndex((line) => line.startsWith("## "));
  if (firstHeadingIndex === -1) return "";

  const miscHeadingIndex = lines.findIndex(
    (line, index) => index >= firstHeadingIndex && line.startsWith("## misc"),
  );
  const endIndex = miscHeadingIndex === -1 ? lines.length : miscHeadingIndex;

  return lines.slice(firstHeadingIndex, endIndex).join("\n");
};

const readme = processReadme(readmeRaw);

export const App = () => {
  return (
    <TooltipProvider delay={0} closeDelay={0}>
      <div className="flex min-h-svh flex-col items-center">
        <SiteProvider>
          <main className="flex w-full max-w-lg flex-col items-start gap-10 px-6 py-16">
            <ProjectInfo />
            <CommandDisplay />
            <ActionButtons />

            <article className="w-full space-y-4 text-sm sm:text-[15px]">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children, node, ...props }) => {
                    const text =
                      node?.children?.[0] && "value" in node.children[0]
                        ? node.children[0].value
                        : "";
                    const id = text
                      .toLowerCase()
                      .replace(/\s+/g, "-")
                      .replace(/[^\w-]/g, "");
                    return (
                      <h2
                        className="mt-12 mb-3 scroll-mt-8 border-t border-border pt-8 text-base font-medium text-foreground first:mt-0 first:border-t-0 first:pt-0"
                        id={id}
                        {...props}
                      >
                        {children}
                      </h2>
                    );
                  },
                  h3: ({ children, ...props }) => (
                    <h3 className="mt-8 mb-2 text-[15px] font-medium text-foreground" {...props}>
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="my-3 leading-relaxed text-muted-foreground">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="my-4 space-y-2 text-[13px] text-muted-foreground sm:text-sm [&_ul]:my-1 [&_ul]:ml-4 [&_ul]:space-y-1">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="relative pl-4 text-muted-foreground [&_p]:inline">
                      <span className="absolute left-0 text-muted-foreground/50">&ndash;</span>
                      {children}
                    </li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 border-l-2 border-border pl-4 text-[13px] text-muted-foreground [&_p]:my-1">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-10 border-border" />,
                  strong: ({ children }) => (
                    <span className="font-medium text-foreground">{children}</span>
                  ),
                  em: ({ children }) => (
                    <em className="not-italic text-muted-foreground">{children}</em>
                  ),
                  img: () => null,
                  code: ({ children, className, node, ...props }) => {
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground sm:text-[13px]"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    const codeText =
                      node?.children?.[0] && "value" in node.children[0]
                        ? node.children[0].value
                        : "";
                    return <CodeBlock className={className}>{codeText}</CodeBlock>;
                  },
                  pre: ({ children }) => <>{children}</>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target={href?.startsWith("http") ? "_blank" : undefined}
                      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-foreground underline decoration-border underline-offset-4 transition-none hover:decoration-foreground"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {readme}
              </Markdown>
            </article>
          </main>

          <footer className="mt-auto flex w-full max-w-lg flex-col gap-6 border-t border-border px-6 pt-8 pb-12">
            <div className="flex items-center gap-3.75 text-caption font-medium leading-5.75">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-none hover:text-foreground"
              >
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/bippy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-none hover:text-foreground"
              >
                npm
              </a>
              <a
                href="/llms.txt"
                className="text-muted-foreground transition-none hover:text-foreground"
              >
                llms.txt
              </a>
            </div>
          </footer>
        </SiteProvider>
      </div>
      <Toaster />
    </TooltipProvider>
  );
};
