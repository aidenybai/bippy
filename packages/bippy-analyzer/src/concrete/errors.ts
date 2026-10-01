import type { Value } from "../../engine/dist/declaration/index.mjs";

export class ConcreteRuntimeError extends Error {
  override name = "ConcreteRuntimeError";
}

export interface ConcreteGuestDiagnostic {
  name: string;
  message: string;
  stack: string | undefined;
  valueType: Value["type"];
  guestStack: string | undefined;
}

const getGuestMessage = (value: Value): string => {
  if (value.type === "String") return value.value;
  if (
    value.type === "Object" &&
    "HostDefinedMessageString" in value &&
    typeof value.HostDefinedMessageString === "string"
  )
    return value.HostDefinedMessageString;
  return `Guest JavaScript threw a value of type ${value.type}`;
};

export class ConcreteGuestError extends Error {
  override name = "ConcreteGuestError";

  constructor(readonly value: Value) {
    super(getGuestMessage(value));
    Object.defineProperty(this, "value", { enumerable: false });
  }

  toJSON = (): ConcreteGuestDiagnostic => ({
    name: this.name,
    message: this.message,
    stack: this.stack,
    valueType: this.value.type,
    guestStack:
      this.value.type === "Object" &&
      "HostDefinedFormattedStack" in this.value &&
      typeof this.value.HostDefinedFormattedStack === "string"
        ? this.value.HostDefinedFormattedStack
        : undefined,
  });
}
