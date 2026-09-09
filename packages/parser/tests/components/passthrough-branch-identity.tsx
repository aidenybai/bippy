import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface Status {
  initialized: boolean;
  language: string;
}

const LocaleContext = createContext<{ name: string }>({ name: "en" });

const zh = { name: "zh" };
const en = { name: "en" };

const loadStatus = (): Promise<Status> =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve({ initialized: navigator.language === "zh", language: navigator.language }),
      0,
    ),
  );

const LocaleProvider = ({
  locale,
  children,
}: {
  locale: { name: string };
  children: React.ReactNode;
}) => {
  const value = useMemo(() => ({ ...locale, exist: true }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

const Setup = () => <main>setup {useContext(LocaleContext).name}</main>;
const Router = () => <main>router {useContext(LocaleContext).name}</main>;

const Inner = ({ status }: { status: Status }) => {
  const locale = status.language === "zh" ? zh : en;
  return (
    <LocaleProvider locale={locale}>{!status.initialized ? <Setup /> : <Router />}</LocaleProvider>
  );
};

export const isPartial = true;

export default function PassthroughBranchIdentity() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const load = async () => {
      setStatus(await loadStatus());
    };
    load();
  }, []);
  if (status === null) return <div>loading</div>;
  return <Inner status={status} />;
}
