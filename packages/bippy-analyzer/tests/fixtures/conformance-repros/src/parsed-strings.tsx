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
