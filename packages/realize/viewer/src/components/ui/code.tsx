import { useMemo, type ComponentProps, type CSSProperties } from "react";
import type { ThemedToken } from "@pierre/diffs";
import { CODE_THEMES, useHighlighter } from "@/hooks/use-highlighter";
import { cn } from "@/lib/utils";

interface CodeProps extends Omit<ComponentProps<"code">, "children"> {
  children: string;
}

interface ThemedStyle extends CSSProperties {
  "--hls-light"?: string;
  "--hls-dark"?: string;
}

const toStyle = (token: ThemedToken): ThemedStyle | undefined => {
  const { htmlStyle } = token;
  if (typeof htmlStyle !== "object" || htmlStyle === null) return undefined;
  return { "--hls-light": htmlStyle["--hls-light"], "--hls-dark": htmlStyle["--hls-dark"] };
};

export const Code = ({ children, className, ...props }: CodeProps) => {
  const highlighter = useHighlighter();
  const tokens = useMemo(
    () =>
      highlighter
        .codeToTokens(children, { lang: "tsx", themes: CODE_THEMES, defaultColor: false })
        .tokens.flat(),
    [highlighter, children],
  );
  return (
    <code data-slot="code" className={cn("font-mono", className)} {...props}>
      {tokens.map((token, index) => (
        <span key={`${index}-${token.content}`} style={toStyle(token)}>
          {token.content}
        </span>
      ))}
    </code>
  );
};
