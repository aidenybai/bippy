import { useEffect, useMemo, useState } from "react";
import { announceEditor, Editor } from "./editor";

const createEditor = (): Editor => {
  const editor = new Editor();
  announceEditor(editor);
  return editor;
};

export const App = () => {
  const editor = useMemo(createEditor, []);
  const [, setMode] = useState(editor.mode);
  useEffect(() => editor.registerModeListener(setMode), [editor]);
  return (
    <main data-mode={editor.mode}>
      {editor.mode === "edit" ? <textarea defaultValue="" /> : <p>{editor.mode}</p>}
    </main>
  );
};
