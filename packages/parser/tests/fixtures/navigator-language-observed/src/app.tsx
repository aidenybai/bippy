const detectLanguages = (): string[] => {
  const found: string[] = [];
  if (navigator.languages) {
    for (let index = 0; index < navigator.languages.length; index++) {
      found.push(navigator.languages[index]);
    }
  }
  if (navigator.language) found.push(navigator.language);
  return found;
};

const detected = detectLanguages();
const preferred = detected.length > 0 ? detected[0] : "unknown";
const hasLanguages = navigator.languages.length >= 1;

export const App = () => (
  <main>
    <h1 lang={preferred}>{preferred}</h1>
    {hasLanguages ? <p>languages known</p> : <p>no languages</p>}
  </main>
);
