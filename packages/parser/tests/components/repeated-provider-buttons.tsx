import { useEffect, useState } from "react";

const Mounted = ({ label }: { label: string }) => {
  const [isMounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return (
    <button type="button">
      {label}
      {isMounted ? <span className="ripple" /> : null}
    </button>
  );
};

export const isPartial = true;

export default function Providers() {
  const [providers, setProviders] = useState<string[] | null>(null);
  useEffect(() => {
    setProviders(document.cookie.split("; "));
  }, []);
  return (
    <div>
      {providers && providers.length > 0 && <hr />}
      {providers &&
        providers.map((provider) => provider === "azure" && <Mounted key="azure" label="Azure" />)}
      {providers &&
        providers.map(
          (provider) => provider === "google" && <Mounted key="google" label="Google" />,
        )}
    </div>
  );
}
