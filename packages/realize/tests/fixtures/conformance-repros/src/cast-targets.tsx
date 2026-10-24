import { useState } from "react";

interface Settings {
  title: string;
  muted: boolean;
}

export const SettingsForm = ({ initial }: { initial: Settings }) => {
  const [settings, setSettings] = useState(initial);
  const update = (field: keyof Settings, value: string | boolean) => {
    const next = { ...settings };
    (next[field] as unknown) = value;
    setSettings(next);
  };
  let heading = settings.title;
  if (!heading) (heading as string) = "Untitled";
  return (
    <div>
      <h2>{heading}</h2>
      <input value={settings.title} onChange={(event) => update("title", event.target.value)} />
      <button onClick={() => update("muted", !settings.muted)}>Mute</button>
    </div>
  );
};
