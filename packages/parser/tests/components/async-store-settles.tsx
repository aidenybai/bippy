import { useState, useSyncExternalStore } from "react";

// A store created in a state initializer validates asynchronously: the promise
// settles in a microtask after mount, and the subscribed component observes the
// settled state exactly once.

type LicenseState = "pending" | "licensed" | "unlicensed";

interface ValidationResult {
  isParseable: boolean;
}

class LicenseManager {
  state: LicenseState = "pending";
  private readonly listeners = new Set<() => void>();

  constructor(licenseKey: string | undefined) {
    this.validate(licenseKey).then((result) => {
      this.setState(result.isParseable ? "licensed" : "unlicensed");
    });
  }

  async validate(licenseKey: string | undefined): Promise<ValidationResult> {
    if (!licenseKey) return { isParseable: false };
    const decoded = await Promise.resolve(licenseKey.trim());
    return { isParseable: decoded.length > 0 };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): LicenseState => this.state;

  private setState(state: LicenseState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const Watermark = ({ manager }: { manager: LicenseManager }) => {
  const state = useSyncExternalStore(manager.subscribe, manager.getState, manager.getState);
  if (state === "pending") return null;
  return (
    <>
      <style>{".watermark { opacity: 0.5 }"}</style>
      <a className="watermark" href="https://example.com">
        {state}
      </a>
    </>
  );
};

export default function AsyncStoreSettles() {
  const [manager] = useState(() => new LicenseManager(undefined));
  return (
    <main>
      <canvas />
      <Watermark manager={manager} />
    </main>
  );
}
