import { useState, type ChangeEvent } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>, checked: boolean) => void;
}

const Switch = ({ checked, onChange }: SwitchProps) => (
  <input
    type="checkbox"
    checked={checked}
    onChange={(event) => onChange(event, event.target.checked)}
  />
);

export const WarningFilter = () => {
  const [isChecked, setIsChecked] = useState(false);
  return (
    <div>
      <Switch checked={isChecked} onChange={(_event, checked) => setIsChecked(checked)} />
      {isChecked ? <p>Warnings only</p> : <p>All events</p>}
    </div>
  );
};
