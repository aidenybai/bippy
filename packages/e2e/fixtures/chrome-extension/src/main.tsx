import { instrument, traverseFiber } from "bippy";
import type { Fiber, FiberRoot } from "bippy";
import { getDisplayNameFromSource, getSource, type SourceFetch } from "bippy/source";
import { createRoot } from "react-dom/client";

interface ExtensionSourceResult {
  displayName: string | null;
  fileName: string | null;
  protocol: string | null;
  sourceRequests: string[];
}

const BookmarkSaveAction = () => <button type="button">Save bookmark</button>;
const requestedSourceUrls: string[] = [];
const sourceFetch: SourceFetch = (url, init) => {
  requestedSourceUrls.push(url);
  return fetch(url, init);
};

const findBookmarkFiber = (root: FiberRoot): Fiber | null => {
  let bookmarkFiber: Fiber | null = null;
  traverseFiber(root.current, (fiber) => {
    if (fiber.type === BookmarkSaveAction) {
      bookmarkFiber = fiber;
      return true;
    }
    return false;
  });
  return bookmarkFiber;
};

let didResolveSource = false;
const resolveSource = async (root: FiberRoot): Promise<void> => {
  if (didResolveSource) return;
  const bookmarkFiber = findBookmarkFiber(root);
  if (!bookmarkFiber) return;
  didResolveSource = true;

  const source = await getSource(bookmarkFiber, true, sourceFetch);
  const displayName = await getDisplayNameFromSource(bookmarkFiber, true, sourceFetch);
  const result: ExtensionSourceResult = {
    displayName,
    fileName: source?.fileName ?? null,
    protocol: source ? new URL(location.href).protocol : null,
    sourceRequests: requestedSourceUrls,
  };
  const resultElement = document.getElementById("result");
  if (resultElement) resultElement.textContent = JSON.stringify(result);
};

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    void resolveSource(root);
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing extension root element");
createRoot(rootElement).render(<BookmarkSaveAction />);
