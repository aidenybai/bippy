export interface Unsubscribe extends Disposable {
  (): void;
}

/**
 * Wraps a teardown callback so it is both callable and a `Disposable`,
 * letting subscriptions compose through explicit resource management:
 *
 * @example
 * ```ts
 * using instrumentation = instrument({ onCommitFiberRoot });
 * using refresh = onReactRefresh(handleRefresh);
 * // both torn down automatically at scope exit
 * ```
 */
export const toUnsubscribe = (dispose: () => void): Unsubscribe =>
  Object.assign(dispose, { [Symbol.dispose]: dispose });
