import { useEffect, useState, type ReactNode } from "react";

const trace: string[] = [];
export const getTrace = () => trace.slice();
interface ChildProps {
  label: string;
  children: ReactNode;
}
const Child = ({ label, children }: ChildProps) => {
  useEffect(() => {
    trace.push("child:mount");
    return () => {
      trace.push("child:cleanup");
    };
  }, []);
  return <section data-label={label}>{children}</section>;
};
const NestedComponents = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    Promise.resolve().then(() => setCount(1));
  }, []);
  return (
    <>
      <Child key="stable" label={`count:${count}`}>
        <strong>nested</strong>
      </Child>
    </>
  );
};
export default NestedComponents;
