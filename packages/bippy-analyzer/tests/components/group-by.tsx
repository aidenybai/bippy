interface Model {
  id: string;
  provider: string;
  tier: number;
}

const models: Model[] = [
  { id: "gpt-5-mini", provider: "OpenAI", tier: 1 },
  { id: "claude-sonnet", provider: "Anthropic", tier: 2 },
  { id: "gpt-5", provider: "OpenAI", tier: 2 },
  { id: "gemini-flash", provider: "Google", tier: 1 },
];

const byProvider = Object.groupBy(models, ({ provider }) => provider);
const byTier = Map.groupBy(models, ({ tier }) => tier);
const byParity = Object.groupBy([1, 2, 3, 4, 5], (value, index) =>
  (value + index * 2) % 2 === 0 ? "even" : "odd",
);
const isPlain = Object.getPrototypeOf(byProvider) === null;
const openAiIds = byProvider.OpenAI?.map(({ id }) => id).join("|") ?? "none";
const missing = byProvider.Mistral === undefined ? "absent" : "present";

export default function GroupBy() {
  return (
    <section>
      <select>
        {Object.entries(byProvider).map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels?.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <ul>
        {[...byTier.entries()].map(([tier, tierModels]) => (
          <li key={tier}>
            {tier}:{tierModels.length}
          </li>
        ))}
      </ul>
      <p>
        {String(isPlain)}/{openAiIds}/{missing}/{byTier.size}/{byParity.even?.join(",")}/
        {byParity.odd?.join(",")}
      </p>
    </section>
  );
}
export const isExact = true;
