import { createContext, useContext, useState } from "react";

/**
 * A consumer that calls a setter from the provider's context value object, and a callback prop,
 * in the same click.
 */

// cc-switch tests/components/ProviderPresetSelector.test.tsx
interface StepState {
  step: "pick" | "form";
  setStep: (step: "pick" | "form") => void;
}

const StepContext = createContext<StepState | null>(null);

const PresetList = ({ onPresetChange }: { onPresetChange: (id: string) => void }) => {
  const state = useContext(StepContext);
  if (!state) return null;
  return state.step === "pick" ? (
    <button
      type="button"
      onClick={() => {
        onPresetChange("custom");
        state.setStep("form");
      }}
    >
      Custom
    </button>
  ) : (
    <button type="button" onClick={() => state.setStep("pick")}>
      Change
    </button>
  );
};

export function PresetSteps({ onPresetChange }: { onPresetChange: (id: string) => void }) {
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [selected, setSelected] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const state: StepState = { step, setStep };
  return (
    <StepContext.Provider value={state}>
      <form>
        <PresetList
          onPresetChange={(id) => {
            setSelected(id);
            setApiKey("");
            onPresetChange(id);
          }}
        />
        {step === "form" && (
          <input
            aria-label="api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
        {selected && <p>{selected}</p>}
      </form>
    </StepContext.Provider>
  );
}
