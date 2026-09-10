import { useCallback, useState } from "react";

export default () => {
  const [attachments, setAttachments] = useState(0);
  const context = Math.random() > 0.5;
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (element) setAttachments((count) => count + 1);
  }, []);
  return (
    <main>
      {context ? <div ref={ref} /> : <aside />}
      <p>attachments: {attachments}</p>
    </main>
  );
};
