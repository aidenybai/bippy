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
import { TextLink } from "@/components/ui/text-link";
import { FiberScrollytelling } from "@/components/fiber-viz/fiber-scrollytelling";
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
    <div className="group relative my-4 max-w-full overflow-hidden rounded-lg border border-divider bg-button px-3 py-2.5 font-mono text-feature-label shadow-button sm:px-4 sm:py-3 [&_code]:bg-transparent! [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
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
      <SiteProvider>
        <div className="font-synthesis-none flex min-h-svh flex-col items-center overflow-x-clip bg-background antialiased">
          <main className="flex w-full flex-col items-center">
            <div className="relative w-full max-w-page min-w-0 px-4 sm:px-0">
              <div className="mt-10 flex flex-col gap-6">
                <ProjectInfo />
                <CommandDisplay />
                <ActionButtons />
              </div>
            </div>

            <FiberScrollytelling />

            <article className="relative mt-14 w-full max-w-page min-w-0 px-4 pb-16 sm:px-0">
              <div className="mb-faq-gap w-full max-w-faq font-openrunde-semibold text-faq-title font-semibold tracking-normal text-section-title">
                docs
              </div>
              <div className="mb-faq-gap h-hairline w-full max-w-faq shrink-0 bg-border" />
              <div className="w-full max-w-faq text-faq-answer">
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
                          className="mt-12 mb-3 scroll-mt-8 font-openrunde-semibold text-faq-title font-semibold tracking-normal text-section-title first:mt-0"
                          id={id}
                          {...props}
                        >
                          {children}
                        </h2>
                      );
                    },
                    h3: ({ children, ...props }) => (
                      <h3
                        className="mt-8 mb-2 font-openrunde-semibold text-faq-title font-semibold tracking-normal text-faq-active"
                        {...props}
                      >
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p className="my-3 font-openrunde-medium text-faq-answer font-medium tracking-normal text-soft-foreground">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="my-4 space-y-2 font-openrunde-medium text-faq-answer font-medium text-soft-foreground [&_ul]:my-1 [&_ul]:ml-4 [&_ul]:space-y-1">
                        {children}
                      </ul>
                    ),
                    li: ({ children }) => (
                      <li className="relative pl-4 font-openrunde-medium font-medium text-soft-foreground [&_p]:inline">
                        <span className="absolute left-0 text-faq-icon">-</span>
                        {children}
                      </li>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="my-4 border-l-2 border-border pl-4 font-openrunde-medium text-faq-answer font-medium text-soft-foreground [&_p]:my-1">
                        {children}
                      </blockquote>
                    ),
                    hr: () => <hr className="my-10 border-border" />,
                    strong: ({ children }) => (
                      <span className="font-medium text-foreground">{children}</span>
                    ),
                    em: ({ children }) => (
                      <em className="not-italic text-soft-foreground">{children}</em>
                    ),
                    img: () => null,
                    code: ({ children, className, node, ...props }) => {
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code
                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-feature-label text-foreground"
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
                    a: ({ href, children }) => {
                      if (!href) return <span>{children}</span>;

                      return (
                        <TextLink
                          href={href}
                          target={href.startsWith("http") ? "_blank" : undefined}
                        >
                          {children}
                        </TextLink>
                      );
                    },
                  }}
                >
                  {readme}
                </Markdown>
              </div>
            </article>
          </main>

          <footer className="mt-auto flex w-full max-w-page flex-col gap-6 px-4 pt-8 pb-12 sm:px-0">
            <div className="flex w-full max-w-faq items-center gap-3.75 border-t border-border pt-8 text-caption font-medium">
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
        </div>
      </SiteProvider>
      <Toaster />
    </TooltipProvider>
  );
};
