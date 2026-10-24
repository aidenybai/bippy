import { Suspense } from "react";

const Loader = async () => {
  await Promise.resolve();
  return <p>Loaded</p>;
};

export const CheckoutPage = () => (
  <Suspense>
    <Loader />
  </Suspense>
);
