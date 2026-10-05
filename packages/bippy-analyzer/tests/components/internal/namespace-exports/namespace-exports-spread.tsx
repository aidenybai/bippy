import * as namespace from "./modules/conflict";

export default () => {
  const snapshot = { ...namespace };
  return (
    <main>
      <span>Result:</span>
      {`${Object.keys(snapshot).join(",")}:${Object.hasOwn(snapshot, "value") ? "present" : "absent"}`}
    </main>
  );
};
