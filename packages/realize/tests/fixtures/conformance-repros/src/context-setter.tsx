import { usePicker } from "./hooks/picker-context";

/**
 * A setter a provider puts in a context, called from a consumer, sets the state field it
 * pairs with, when a provider is mounted above.
 */

// chatbot-ui components/chat/prompt-picker.tsx
export function PickerToggle() {
  const { isPickerOpen, setIsPickerOpen } = usePicker();
  return (
    <div>
      <button type="button" onClick={() => setIsPickerOpen(!isPickerOpen)}>
        Prompts
      </button>
      {isPickerOpen ? <ul>Picker</ul> : null}
    </div>
  );
}
