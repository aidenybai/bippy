import { Switch as HeadlessSwitch } from "@headlessui/react";
import { useSelect } from "downshift";
import { useState } from "react";
import { Button as AriaButton, ToggleButton } from "react-aria-components";

import type { LibrarySection } from "../section-registry";

const ReactAriaSection = () => {
  const [pressCount, setPressCount] = useState(0);
  return (
    <div>
      <AriaButton
        data-testid="interact-react-aria"
        onPress={() => setPressCount((previous) => previous + 1)}
      >
        aria:{pressCount}
      </AriaButton>
      <ToggleButton>toggle</ToggleButton>
    </div>
  );
};

const HeadlessUiSection = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  return (
    <HeadlessSwitch data-testid="interact-headlessui" checked={isEnabled} onChange={setIsEnabled}>
      headlessui:{String(isEnabled)}
    </HeadlessSwitch>
  );
};

const downshiftItems = ["apple", "banana", "cherry"];

const DownshiftSection = () => {
  const { isOpen, selectedItem, getToggleButtonProps, getMenuProps, getItemProps } = useSelect({
    items: downshiftItems,
  });
  return (
    <div>
      <button data-testid="interact-downshift" {...getToggleButtonProps()}>
        {selectedItem ?? "pick a fruit"}
      </button>
      <ul {...getMenuProps()}>
        {isOpen &&
          downshiftItems.map((item, itemIndex) => (
            <li key={item} {...getItemProps({ item, index: itemIndex })}>
              {item}
            </li>
          ))}
      </ul>
    </div>
  );
};

export const ariaHeadlessSections: LibrarySection[] = [
  { name: "react-aria-components", Component: ReactAriaSection },
  { name: "headlessui", Component: HeadlessUiSection },
  { name: "downshift", Component: DownshiftSection },
];
