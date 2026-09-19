import type { HostDocument } from "../host/host-document.js";

/**
 * What the analysis needs of the renderer a program targets, beyond the
 * document its interpreted code reads (`hostDocument`): which host tags the
 * reconciler gives no children, and the containers roots and portals mount in.
 * React DOM's lives in `render/dom-host.ts`; another renderer supplies its own.
 */
export interface RendererHost<
  Container extends object = object,
  RootContainer extends object = Container,
> {
  readonly hostDocument: HostDocument;
  /** Whether the renderer never reconciles the tag's `children` into child fibers. */
  isChildlessTag(tagName: string): boolean;
  isContainer(value: unknown): value is Container;
  createRootContainer(): RootContainer;
  attachRootContainer(container: RootContainer): () => void;
  createContainer(): Container;
}
