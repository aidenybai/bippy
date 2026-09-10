import { Component, createRef, useEffect, useRef, useState } from "react";

interface CanvasState {
  isZooming: boolean;
  isFullscreen: boolean;
  hasTextSelection: boolean;
}

class Canvas extends Component<Record<string, never>, CanvasState> {
  state: CanvasState = { isZooming: false, isFullscreen: false, hasTextSelection: false };
  private readonly containerRef = createRef<HTMLDivElement>();
  private readonly onGestureStart = () => this.setState({ isZooming: true });
  private readonly onFullscreenChange = () => this.setState({ isFullscreen: true });
  private readonly onSelect = () => this.setState({ hasTextSelection: true });

  componentDidMount() {
    const container = this.containerRef.current!;
    const ownerDocument = container.ownerDocument;
    ownerDocument.addEventListener("gesturestart", this.onGestureStart);
    ownerDocument.addEventListener("fullscreenchange", this.onFullscreenChange);
    container.addEventListener("select", this.onSelect);
  }

  componentWillUnmount() {
    const container = this.containerRef.current!;
    const ownerDocument = container.ownerDocument;
    ownerDocument.removeEventListener("gesturestart", this.onGestureStart);
    ownerDocument.removeEventListener("fullscreenchange", this.onFullscreenChange);
    container.removeEventListener("select", this.onSelect);
  }

  render() {
    return (
      <div ref={this.containerRef}>
        {this.state.isZooming && <i>zooming</i>}
        {this.state.isFullscreen && <b>fullscreen</b>}
        {this.state.hasTextSelection && <u>text selected</u>}
      </div>
    );
  }
}

export const App = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasLeft, setHasLeft] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const input = inputRef.current!;
    const onFocusOut = () => setHasLeft(true);
    const onFocus = () => setIsFocused(true);
    const onSelectionChange = () => setHasSelection(true);
    input.addEventListener("focusout", onFocusOut);
    input.addEventListener("focus", onFocus);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      input.removeEventListener("focusout", onFocusOut);
      input.removeEventListener("focus", onFocus);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);
  return (
    <form>
      <input ref={inputRef} />
      {hasLeft && <em>left</em>}
      {isFocused && <strong>focused</strong>}
      {hasSelection && <small>selected</small>}
      <Canvas />
    </form>
  );
};
