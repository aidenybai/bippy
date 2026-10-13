import i18next from "i18next";
import { CheckCircle, Zap } from "lucide-react";
import { useState } from "react";
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

const ErrorBoundarySection = () => {
  const [shouldThrow, setShouldThrow] = useState(false);
  return (
    <div>
      <ErrorBoundary
        onReset={() => setShouldThrow(false)}
        fallbackRender={({ resetErrorBoundary }) => (
          <button data-testid="error-boundary-reset" onClick={() => resetErrorBoundary()}>
            caught, reset
          </button>
        )}
      >
        <ThrowingChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
      <button data-testid="error-boundary-trigger" onClick={() => setShouldThrow(true)}>
        break child
      </button>
    </div>
  );
};

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
    de: { translation: { greeting: "hallo von i18next" } },
  },
});

const TranslatedGreeting = () => {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <div data-testid="i18next-greeting">{t("greeting")}</div>
      <button
        data-testid="interact-i18next"
        onClick={() => i18n.changeLanguage(i18n.language === "en" ? "de" : "en")}
      >
        switch language
      </button>
    </div>
  );
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
