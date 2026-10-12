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
