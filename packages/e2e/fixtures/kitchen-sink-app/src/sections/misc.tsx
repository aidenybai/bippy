import i18next from "i18next";
import { CheckCircle, Zap } from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { useInView } from "react-intersection-observer";
import { useToggle } from "react-use";
import { useCounter } from "usehooks-ts";

import type { LibrarySection } from "../section-registry";

const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error("intentional");
  }
  return <div data-testid="error-boundary-child">boundary child ok</div>;
};

const ErrorBoundarySection = () => (
  <ErrorBoundary fallback={<div>caught</div>}>
    <ThrowingChild shouldThrow={false} />
  </ErrorBoundary>
);

const IntersectionObserverSection = () => {
  const { ref, inView } = useInView();
  return (
    <div ref={ref} data-testid="in-view-target">
      in view: {String(inView)}
    </div>
  );
};

const ReactUseSection = () => {
  const [isOn, toggle] = useToggle(false);
  return (
    <button data-testid="interact-react-use" onClick={toggle}>
      react-use:{String(isOn)}
    </button>
  );
};

const UsehooksTsSection = () => {
  const { count, increment } = useCounter(0);
  return (
    <button data-testid="interact-usehooks-ts" onClick={increment}>
      usehooks-ts:{count}
    </button>
  );
};

const i18nInstance = i18next.createInstance();
void i18nInstance.use(initReactI18next).init({
  lng: "en",
  resources: {
    en: { translation: { greeting: "hello from i18next" } },
  },
});

const TranslatedGreeting = () => {
  const { t } = useTranslation();
  return <div data-testid="i18next-greeting">{t("greeting")}</div>;
};

const I18nextSection = () => (
  <I18nextProvider i18n={i18nInstance}>
    <TranslatedGreeting />
  </I18nextProvider>
);

const LucideSection = () => (
  <div data-testid="lucide-icons">
    <CheckCircle aria-label="check icon" />
    <Zap aria-label="zap icon" />
  </div>
);

export const miscSections: LibrarySection[] = [
  { name: "react-error-boundary", Component: ErrorBoundarySection },
  { name: "react-intersection-observer", Component: IntersectionObserverSection },
  { name: "react-use", Component: ReactUseSection },
  { name: "usehooks-ts", Component: UsehooksTsSection },
  { name: "react-i18next", Component: I18nextSection },
  { name: "lucide-react", Component: LucideSection },
];
