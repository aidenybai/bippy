import {
  instrument,
  secure,
  traverseRenderedFibers,
  isCompositeFiber,
  getDisplayName,
  traverseProps,
  traverseContexts,
  traverseState,
} from 'bippy'; // must be imported BEFORE react

instrument(
  secure({
    onCommitFiberRoot(rendererID, root) {
      traverseRenderedFibers(root, (fiber) => {
        /**
         * `isCompositeFiber` is a utility function that checks if a fiber is a composite fiber.
         * a composite fiber is a fiber that represents a function or class component.
         */
        if (!isCompositeFiber(fiber)) return;

        /**
         * `getDisplayName` is a utility function that gets the display name of a fiber.
         */
        const displayName = getDisplayName(fiber);
        if (!displayName) return;

        const changes = [];

        /**
         * `traverseProps` is a utility function that traverses the props of a fiber.
         */
        traverseProps(fiber, (propName, next, prev) => {
          if (next !== prev) {
            changes.push({
              name: `prop ${propName}`,
              prev,
              next,
            });
          }
        });

        let contextId = 0;
        /**
         * `traverseContexts` is a utility function that traverses the contexts of a fiber.
         * Contexts don't have a "name" like props, so we use an id to identify them.
         */
        traverseContexts(fiber, (next, prev) => {
          if (next !== prev) {
            changes.push({
              name: `context ${contextId}`,
              prev,
              next,
              contextId,
            });
          }
          contextId++;
        });

        let stateId = 0;
        /**
         * `traverseState` is a utility function that traverses the state of a fiber.
         *
         * State don't have a "name" like props, so we use an id to identify them.
         */
        traverseState(fiber, (value, prevValue) => {
          if (value !== prevValue) {
            changes.push({
              name: `state ${stateId}`,
              prev: prevValue,
              next: value,
            });
          }
          stateId++;
        });

        console.group(
          `%c${displayName}`,
          'background: hsla(0,0%,70%,.3); border-radius:3px; padding: 0 2px;'
        );
        for (const { name, prev, next } of changes) {
          console.log(`${name}:`, prev, '!==', next);
        }
        console.groupEnd();
      });
    },
  })
);