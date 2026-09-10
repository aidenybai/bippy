const enabledFeatures = ["grid", "flex", "motion"].filter(
  (feature) => feature.length + Date.now() > 0,
);

const reservedProps = new Set([...enabledFeatures, "as", "sx"]);

const shouldForwardProp = (prop: string) => !reservedProps.has(prop);

export const isExact = true;

export default function SetMembershipDynamic() {
  return (
    <ul>
      {["as", "sx"].map((prop) =>
        shouldForwardProp(prop) ? (
          <li key={prop}>{prop}</li>
        ) : (
          <li key={prop}>
            <s>{prop}</s>
          </li>
        ),
      )}
    </ul>
  );
}
