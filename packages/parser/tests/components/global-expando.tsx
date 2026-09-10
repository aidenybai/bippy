const slotKey = "@test/context:Slot";

class Slot {
  readonly id = "slot";
}

const globalHost: Record<string, unknown> = globalThis;

const SharedSlot: typeof Slot =
  globalHost[slotKey] ||
  Array[slotKey] ||
  ((SlotClass: typeof Slot) => {
    try {
      Object.defineProperty(globalHost, slotKey, {
        value: SlotClass,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    } finally {
      return SlotClass;
    }
  })(Slot);

Array["counter"] = 1;
Array["counter"] += 1;

const GlobalExpando = () => (
  <ul>
    <li>{String(SharedSlot === Slot)}</li>
    <li>{String(globalHost[slotKey] === Slot)}</li>
    <li>{new SharedSlot().id}</li>
    <li>{String(Array["counter"])}</li>
    <li>{String(Array["missing"])}</li>
    <li>{String("isArray" in Array)}</li>
  </ul>
);

export default GlobalExpando;
