import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useState,
} from "react";

const trace: string[] = [];
export const getTrace = () => trace.slice();
interface ChildProps {
  read: () => string;
}
const Child = memo(({ read }: ChildProps) => {
  trace.push("child:render");
  const element = cloneElement(<b>old</b>, {}, read());
  return (
    <output>
      {String(isValidElement(element))}:{Children.count([null, element])}
      {Children.only(element)}
    </output>
  );
});
const MemoChildren = () => {
  const [count, setCount] = useState(0);
  const read = useCallback(() => "stable", []);
  useEffect(() => {
    setCount(1);
  }, []);
  return (
    <section data-count={count}>
      <Child read={read} />
    </section>
  );
};
export default MemoChildren;
