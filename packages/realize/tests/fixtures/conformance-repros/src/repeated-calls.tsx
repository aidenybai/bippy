interface Provider {
  name: string;
  tags: string[];
}

export const ProviderRow = ({ provider }: { provider: Provider }) => (
  <li>
    {provider.name.startsWith("Local") ? <p>local</p> : null}
    {provider.name.startsWith("Local") ? null : <i>remote</i>}
    {provider.tags.includes("beta") ? <b>beta</b> : null}
    {provider.tags.includes("beta") ? null : <s>stable</s>}
  </li>
);
