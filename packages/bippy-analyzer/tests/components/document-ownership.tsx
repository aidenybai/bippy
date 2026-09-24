import { useLayoutEffect, useRef, useState } from "react";

/** An editor claiming a DOM element through an expando, the way rich-text editors mark their root. */
class Editor {
  key = "e1";
}

interface EditorHost extends Node {
  __editor?: Editor | null;
}

interface OwnedDocument extends Document {
  __editors?: Editor[];
}

interface Readout {
  isDetached: boolean;
  isRootDocument: boolean;
  isActive: boolean;
  isEditorAttached: boolean;
  isRootActive: boolean;
  hasNodeType: boolean;
  hasActiveElement: boolean;
  hasRegistry: boolean;
  registrySize: number;
}

const getEditorProperty = (node: EditorHost | null): unknown => (node ? node.__editor : null);

const readEditorState = (element: HTMLElement & EditorHost, editor: Editor): Readout => {
  element.__editor = editor;
  element.contentEditable = "true";
  element.focus();
  const root = element.getRootNode();
  const ownerDocument: OwnedDocument = element.ownerDocument;
  ownerDocument.__editors = [editor];
  const activeElement = ownerDocument.activeElement;
  return {
    isDetached: getEditorProperty(element) === null || getEditorProperty(element) === undefined,
    isRootDocument: root.nodeType === 9,
    isActive: activeElement === element,
    isEditorAttached: getEditorProperty(activeElement) === editor,
    isRootActive: root.nodeType === 9 && "activeElement" in root && root.activeElement === element,
    hasNodeType: "nodeType" in element,
    hasActiveElement: "activeElement" in root,
    hasRegistry: "__editors" in ownerDocument,
    registrySize: ownerDocument.__editors.length,
  };
};

const EditorReadout = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  useLayoutEffect(() => {
    if (ref.current) setReadout(readEditorState(ref.current, new Editor()));
  }, []);
  return (
    <div>
      <div ref={ref} />
      {readout === null ? null : (
        <output>
          {readout.isDetached ? <b>detached</b> : <i>attached</i>}
          {readout.isRootDocument ? <b>document</b> : <i>fragment</i>}
          {readout.isActive ? <b>active</b> : <i>inactive</i>}
          {readout.isEditorAttached ? <b>editor</b> : <i>no-editor</i>}
          {readout.isRootActive ? <b>root-active</b> : <i>root-inactive</i>}
          {readout.hasNodeType ? <b>node-type</b> : <i>no-node-type</i>}
          {readout.hasActiveElement ? <b>active-element</b> : <i>no-active-element</i>}
          {readout.hasRegistry ? <b>registry</b> : <i>no-registry</i>}
          {readout.registrySize === 1 ? <b>one</b> : <i>many</i>}
        </output>
      )}
    </div>
  );
};

export default EditorReadout;
export const isExact = true;
