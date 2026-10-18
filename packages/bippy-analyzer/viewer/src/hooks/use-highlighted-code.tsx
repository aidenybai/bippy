import { useEffect, useState, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { codeToHast } from "shiki";

const highlight = async (source: string): Promise<ReactNode> => {
  const tree = await codeToHast(source, { lang: "tsx", theme: "github-light" });
  return toJsxRuntime(tree, { Fragment, jsx, jsxs });
};

export const useHighlightedCode = (source: string): ReactNode => {
  const [code, setCode] = useState<ReactNode>(null);
  useEffect(() => {
    let isCurrent = true;
    highlight(source).then((result) => {
      if (isCurrent) setCode(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [source]);
  return code;
};
