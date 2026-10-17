import { useState } from "react";

const Column = (): PropertyDecorator => () => undefined;

export class Policy {
  @Column()
  isAllowed = false;
}

export const PolicyToggle = () => {
  const [isAllowed, setIsAllowed] = useState(false);
  return (
    <button type="button" onClick={() => setIsAllowed(!isAllowed)}>
      {isAllowed ? "Allowed" : "Denied"}
    </button>
  );
};
