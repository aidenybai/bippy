import { useEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { count, increment } from "./modules/counter.js";

const BundledModules = () => {
  const [, setTick] = useState(0);
  useEffect(() => {
    increment();
    setTick(1);
  }, []);
  return jsx("output", { children: count });
};
export default BundledModules;
