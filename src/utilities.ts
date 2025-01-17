export interface StackNode<T> {
  next: StackNode<T> | undefined;
  value: T;
}

export function createStackNode<T>(
  value: T,
  next?: StackNode<T>,
): StackNode<T> {
  return {
    next,
    value,
  };
}
