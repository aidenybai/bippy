export const makeFormHandlers = (isOpen: boolean, onClose: () => void) => {
  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (isOpen) onClose();
  };
  return { handleSubmit };
};

export const makeKeyHandler =
  (isOpen: boolean, onClose: () => void) => (event: { key: string }) => {
    if (isOpen && event.key === "Escape") onClose();
  };
