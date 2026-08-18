// Ported from facebook/react packages/react-refresh/src/__tests__/
// ReactFreshMultipleRenderer-test.internal.js (MIT licensed, Copyright (c)
// Meta Platforms, Inc. and affiliates). The original pairs react-dom with
// react-art; this port pairs react-dom with react-konva, a real
// react-reconciler-based canvas renderer that works headlessly.
import { _renderers, ReactBuildType } from "bippy";
import type Konva from "konva";
import * as React from "react";
// KonvaRenderer must come from the same module instance that Stage uses,
// otherwise injectIntoDevTools wires up a second, unused reconciler copy.
import { KonvaRenderer, Layer, Rect, Stage } from "react-konva";

import type { HarnessTools, Scenario } from "../harness";

// react-konva does not inject its reconciler into the DevTools hook on its
// own, which real apps work around the same way; injection must happen
// before the first Stage mounts so react-refresh records its helpers.
let didInjectKonvaRenderer = false;
const injectKonvaRendererIntoDevTools = (): void => {
  if (didInjectKonvaRenderer) return;
  didInjectKonvaRenderer = true;
  KonvaRenderer.injectIntoDevTools({
    bundleType: ReactBuildType.Development,
    findFiberByHostInstance: () => null,
    rendererPackageName: "react-konva",
    version: React.version,
  });
};

interface KonvaRectRef {
  current: Konva.Rect | null;
}

const defineInner = (tools: HarnessTools, fill: string, rectRef: KonvaRectRef) => {
  const Inner = () => <Rect ref={rectRef} width={40} height={40} fill={fill} />;
  tools.register(Inner, "Inner");
  return Inner;
};

export const multiRendererScenarios: Record<string, Scenario> = {
  "refreshes components rendered by two renderers on one page": async (tools) => {
    const { render, act, ReactFreshRuntime, expect, firstElement, container } = tools;

    injectKonvaRendererIntoDevTools();
    const rectRef: KonvaRectRef = { current: null };

    const defineOuter = (color: string, Inner: React.ComponentType<object>) => {
      const Outer = () => (
        <div style={{ color }}>
          <Stage width={50} height={50}>
            <Layer>
              <Inner />
            </Layer>
          </Stage>
        </div>
      );
      tools.register(Outer, "Outer");
      return Outer;
    };

    const InnerV1 = defineInner(tools, "blue", rectRef);
    await render(() => defineOuter("blue", InnerV1));

    const element = firstElement();
    const rectNode = rectRef.current;
    if (!rectNode) {
      throw new Error("expected the konva rect to mount");
    }
    expect(element.style.color).toBe("blue");
    expect(rectNode.fill()).toBe("blue");

    // Both react-dom and react-konva's reconciler injected into the hook,
    // and bippy must be tracking both renderers.
    if (_renderers.size < 2) {
      throw new Error(`expected bippy to track both renderers, saw ${_renderers.size}`);
    }

    // Hot update the konva-rendered component only.
    defineInner(tools, "red", rectRef);
    await act(() => {
      ReactFreshRuntime.performReactRefresh();
    });
    expect(container.firstChild).toBe(element);
    expect(rectRef.current).toBe(rectNode);
    expect(element.style.color).toBe("blue");
    expect(rectNode.fill()).toBe("red");

    // Hot update the DOM-rendered component only.
    defineOuter("red", InnerV1);
    await act(() => {
      ReactFreshRuntime.performReactRefresh();
    });
    expect(container.firstChild).toBe(element);
    expect(element.style.color).toBe("red");
    expect(rectRef.current).toBe(rectNode);
    expect(rectNode.fill()).toBe("red");
  },
};
