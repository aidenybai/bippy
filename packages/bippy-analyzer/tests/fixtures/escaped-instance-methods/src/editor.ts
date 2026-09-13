type Listener = (mode: string) => void;
type ReadyHook = (editor: Editor) => void;

const readyHooks = new Set<ReadyHook>();

window.addEventListener("message", (event) => {
  if (typeof event.data === "function") readyHooks.add(event.data);
});

export class Editor {
  mode = "read";
  private readonly listeners = new Set<Listener>();

  setMode(mode: string): void {
    this.mode = mode;
    for (const listener of this.listeners) listener(mode);
  }

  registerModeListener(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const announceEditor = (editor: Editor): void => {
  for (const hook of readyHooks) hook(editor);
};
