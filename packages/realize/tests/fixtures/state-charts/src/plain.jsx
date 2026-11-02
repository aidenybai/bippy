import { useState } from "react";

export const Toggle = ({ label, variant }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={variant === "compact" ? "small" : "large"}>
      <button onClick={() => setIsOpen(!isOpen)}>{label}</button>
      {isOpen && <p>Details</p>}
    </div>
  );
};

export const Page = () => <Toggle label="More" variant="compact" />;
