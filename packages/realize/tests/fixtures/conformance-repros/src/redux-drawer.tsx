import { useDispatch, useSelector } from "store-hooks";

export const DrawerToggle = () => {
  const dispatch = useDispatch();
  const isOpen = useSelector((state) => state.isOpen);
  return (
    <button onClick={() => dispatch({ type: "drawer/toggle" })}>{isOpen ? "Close" : "Open"}</button>
  );
};
