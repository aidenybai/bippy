import type { ComponentProps } from "react";
import { CODE_THEME, useHighlighter } from "@/hooks/use-highlighter";
import { cn } from "@/lib/utils";

interface CodeProps extends Omit<ComponentProps<"code">, "children"> {
  children: string;
}

export const Code = ({ children, className, ...props }: CodeProps) => {
  const highlighter = useHighlighter();
  const tokens = highlighter?.codeToTokensBase(children, { lang: "tsx", theme: CODE_THEME }) ?? [];
  return (
    <code data-slot="code" className={cn("font-mono", className)} {...props}>
      {tokens.length === 0
        ? children
        : tokens.flat().map((token, index) => (
            <span key={`${index}-${token.content}`} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
    </code>
  );
};
