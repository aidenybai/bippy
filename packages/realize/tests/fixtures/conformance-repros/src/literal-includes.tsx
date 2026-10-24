type Plan = "free" | "pro" | "team";
type PaidPlan = "pro" | "team";

const PAID_PLANS: ReadonlyArray<Plan> = ["pro", "team"];

const Invoice = ({ plan }: { plan: PaidPlan }) => <a href={`/invoice/${plan}`}>{plan}</a>;

export const PlanBadge = ({ plan }: { plan: Plan }) => {
  const paid = PAID_PLANS.includes(plan) ? (plan as PaidPlan) : null;
  const isShared = ["free", "team"].includes(plan);
  return (
    <div>
      {paid ? <Invoice plan={paid} /> : null}
      {isShared ? <b>shared</b> : null}
    </div>
  );
};
