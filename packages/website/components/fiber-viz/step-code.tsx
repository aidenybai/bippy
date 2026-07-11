import { useEffect, useState } from "react";
import { highlight, highlightWithLineEmphasis } from "@/lib/shiki";

interface StepCodeProps {
  code: string;
  language: string;
  emphasizedLines?: number[];
}

export const StepCode = ({ code, language, emphasizedLines }: StepCodeProps) => {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const render = emphasizedLines?.length
      ? highlightWithLineEmphasis(code, language, emphasizedLines)
      : highlight(code, language);
    render.then(setHtml);
  }, [code, language, emphasizedLines]);

  return (
    <div className="fiber-viz-code max-w-full overflow-hidden rounded-lg border border-divider bg-button px-3 py-2.5 font-mono text-feature-label shadow-button sm:px-4 sm:py-3 [&_code]:bg-transparent! [&_pre]:bg-transparent! [&_pre]:p-0! [&_pre]:whitespace-pre-wrap [&_pre]:break-words">
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
