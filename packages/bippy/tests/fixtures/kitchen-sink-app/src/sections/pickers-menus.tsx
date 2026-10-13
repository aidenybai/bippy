import { Command } from "cmdk";
import { useState } from "react";
import Select from "react-select";

import type { LibrarySection } from "../section-registry";

const selectOptions = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
];

const ReactSelectSection = () => {
  const [selectedOption, setSelectedOption] = useState(selectOptions[0]);
  return (
    <div data-testid="react-select-host">
      <Select
        inputId="react-select-input"
        options={selectOptions}
        value={selectedOption}
        onChange={(nextOption) => {
          if (nextOption) setSelectedOption(nextOption);
        }}
      />
    </div>
  );
};

const CmdkSection = () => (
  <Command label="command menu">
    <Command.Input data-testid="cmdk-input" placeholder="search" />
    <Command.List>
      <Command.Item>first command</Command.Item>
      <Command.Item>second command</Command.Item>
      <Command.Empty>no results</Command.Empty>
    </Command.List>
  </Command>
);

export const pickerMenuSections: LibrarySection[] = [
  { name: "react-select", Component: ReactSelectSection },
  { name: "cmdk", Component: CmdkSection },
];
