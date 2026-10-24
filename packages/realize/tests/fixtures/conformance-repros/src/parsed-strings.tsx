interface Price {
  amount: string;
  currencyCode: string;
}

interface ReceiptProps {
  createdAt: string;
  paidOn: Date;
  price: Price;
}

export const Receipt = ({ createdAt, paidOn, price }: ReceiptProps) => (
  <p>
    {new Date(createdAt).toISOString()} {paidOn.toDateString()}{" "}
    {new Intl.NumberFormat("en", { style: "currency", currency: price.currencyCode }).format(
      Number(price.amount),
    )}
  </p>
);

// oxlint-disable-next-line typescript/no-explicit-any -- an untyped prop, as in plain JavaScript.
export const DateLabel = ({ endDate }: { endDate: any }) => (
  <p>{new Date(endDate).toISOString()}</p>
);

export const Greeting = ({ locale }: { locale: string }) => (
  <p>{new Intl.DateTimeFormat(locale).format(0)}</p>
);

export const Swatch = ({ primaryColor }: { primaryColor: string }) => (
  <span style={{ color: primaryColor }}>Aa</span>
);

export const Toolbar = ({ actions }: { actions: React.ReactNode[] }) => (
  <div>
    {actions.map((action, index) => (
      <span key={index}>{action}</span>
    ))}
  </div>
);

export const NamespaceFilter = ({ namespaces }: { namespaces: Set<string> }) => (
  <p>{[...namespaces.values()].join(", ")}</p>
);

type SvgCache = Map<string, string>;

export const CachedIcon = ({ cache }: { cache: SvgCache }) => <p>{cache.get("icon")}</p>;

type Moment = Date;
type Icon = React.ReactElement;

export const AliasedTypes = ({ when, icon }: { when: Moment; icon: Icon }) => (
  <p>
    {icon}
    {when.toISOString()}
  </p>
);
