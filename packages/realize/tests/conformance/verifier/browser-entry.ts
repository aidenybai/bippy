import "./browser/pending-callbacks";
import "./stubs/node-globals";
import "./stubs/tauri-globals";
import "./stubs/react-shims";
import { instrument } from "bippy";
import { collectActions, performAction } from "./browser/actions";
import { captureMountedComponent, recordFirstCommitShapes } from "./browser/capture";
import { recordCommit } from "./browser/fibers";
import { loadWrapper } from "./browser/load";
import { mount } from "./browser/mount";
import { trackStates } from "./browser/mutations";
import {
  hasPendingActionTimers,
  recordCommitFlags,
  recordPassiveFlush,
} from "./browser/pending-callbacks";
import { settle } from "./browser/settle";

instrument({
  onCommitFiberRoot: (_rendererId, root) => {
    recordCommitFlags(root.current.flags | root.current.subtreeFlags);
    const fiber = recordCommit(root);
    if (!fiber) return;
    recordFirstCommitShapes(fiber);
    trackStates(fiber);
  },
  onPostCommitFiberRoot: recordPassiveFlush,
});

const preventLinkNavigation = (event: Event): void => {
  const target = event.target;
  if (target instanceof Element && target.closest("a[href]")) event.preventDefault();
};

const preventSubmitNavigation = (event: Event): void => event.preventDefault();

document.addEventListener("click", preventLinkNavigation, true);
window.addEventListener("submit", preventSubmitNavigation);
navigation.addEventListener("navigate", (event) => {
  if (event.cancelable && !event.hashChange) event.preventDefault();
});
history.back = () => {};
history.go = () => {};

window.__verify = {
  mount,
  actions: () => collectActions().map(({ element: _element, value: _value, ...action }) => action),
  perform: performAction,
  hasActionTimers: hasPendingActionTimers,
  observe: async () => {
    await settle();
    return captureMountedComponent();
  },
  canLoad: async (wrapper) => (await loadWrapper(wrapper)) !== null,
};
