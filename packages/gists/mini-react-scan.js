import {
  instrument,
  secure,
  getNearestHostFiber,
  traverseRenderedFibers,
} from 'bippy'; // must be imported BEFORE react

const highlightFiber = (fiber) => {
  if (!(fiber.stateNode instanceof HTMLElement)) return;
  // fiber.stateNode is a DOM element
  const rect = fiber.stateNode.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.style.border = '1px solid red';
  highlight.style.position = 'fixed';
  highlight.style.top = `${rect.top}px`;
  highlight.style.left = `${rect.left}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.style.zIndex = '999999999';
  document.documentElement.appendChild(highlight);
  setTimeout(() => {
    document.documentElement.removeChild(highlight);
  }, 100);
};

/**
 * `instrument` is a function that installs the react DevTools global
 * hook and allows you to set up custom handlers for react fiber events.
 */
instrument(
  /**
   * `secure` is a function that wraps your handlers in a try/catch
   * and prevents it from crashing the app. it also prevents it from
   * running on unsupported react versions and during production.
   *
   * this is not required but highly recommended to provide "safeguards"
   * in case something breaks.
   */
  secure({
    /**
     * `onCommitFiberRoot` is a handler that is called when react is
     * ready to commit a fiber root. this means that react is has
     * rendered your entire app and is ready to apply changes to
     * the host tree (e.g. via DOM mutations).
     */
    onCommitFiberRoot(rendererID, root) {
      /**
       * `traverseRenderedFibers` traverses the fiber tree and determines which
       * fibers have actually rendered.
       *
       * A fiber tree contains many fibers that may have not rendered. this
       * can be because it bailed out (e.g. `useMemo`) or because it wasn't
       * actually rendered (if <Child> re-rendered, then <Parent> didn't
       * actually render, but exists in the fiber tree).
       */
      traverseRenderedFibers(root, (fiber) => {
        /**
         * `getNearestHostFiber` is a utility function that finds the
         * nearest host fiber to a given fiber.
         *
         * a host fiber for `react-dom` is a fiber that has a DOM element
         * as its `stateNode`.
         */
        const hostFiber = getNearestHostFiber(fiber);
        highlightFiber(hostFiber);
      });
    },
  })
);