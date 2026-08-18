import * as Accordion from "@radix-ui/react-accordion";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";

import type { LibrarySection } from "../section-registry";

const RadixDialogSection = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger data-testid="interact-radix-dialog">open dialog</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content>
          <Dialog.Title>radix dialog</Dialog.Title>
          <Dialog.Description data-testid="radix-dialog-content">dialog content</Dialog.Description>
          <Dialog.Close>close</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const RadixTabsSection = () => (
  <Tabs.Root defaultValue="first">
    <Tabs.List>
      <Tabs.Trigger data-testid="interact-radix-tabs" value="second">
        second tab
      </Tabs.Trigger>
      <Tabs.Trigger value="first">first tab</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="first">first content</Tabs.Content>
    <Tabs.Content value="second" data-testid="radix-tabs-second">
      second content
    </Tabs.Content>
  </Tabs.Root>
);

const RadixSwitchSection = () => {
  const [isChecked, setIsChecked] = useState(false);
  return (
    <Switch.Root
      data-testid="interact-radix-switch"
      checked={isChecked}
      onCheckedChange={setIsChecked}
    >
      {/* tailwind preflight collapses an empty button to zero size */}
      <Switch.Thumb>{isChecked ? "on" : "off"}</Switch.Thumb>
    </Switch.Root>
  );
};

const RadixTooltipSection = () => (
  <Tooltip.Provider delayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger data-testid="radix-tooltip-trigger">hover me</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content>tooltip content</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

const RadixPopoverSection = () => (
  <Popover.Root>
    <Popover.Trigger data-testid="interact-radix-popover">open popover</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content data-testid="radix-popover-content">popover content</Popover.Content>
    </Popover.Portal>
  </Popover.Root>
);

const RadixAccordionSection = () => (
  <Accordion.Root type="single" collapsible>
    <Accordion.Item value="item-1">
      <Accordion.Header>
        <Accordion.Trigger data-testid="interact-radix-accordion">expand</Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content>accordion content</Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
);

export const radixSections: LibrarySection[] = [
  { name: "radix-dialog", Component: RadixDialogSection },
  { name: "radix-tabs", Component: RadixTabsSection },
  { name: "radix-switch", Component: RadixSwitchSection },
  { name: "radix-tooltip", Component: RadixTooltipSection },
  { name: "radix-popover", Component: RadixPopoverSection },
  { name: "radix-accordion", Component: RadixAccordionSection },
];
