import type { ComponentProps } from "react";
import { getCodeTheme, useHighlighter } from "@/hooks/use-highlighter";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";
import { cn } from "@/lib/utils";

interface CodeProps extends Omit<ComponentProps<"code">, "children"> {
  children: string;
}

export const Code = ({ children, className, ...props }: CodeProps) => {
  const highlighter = useHighlighter();
  const { theme } = useResolvedTheme();
  const tokens =
    highlighter?.codeToTokensBase(children, { lang: "tsx", theme: getCodeTheme(theme) }) ?? [];
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
