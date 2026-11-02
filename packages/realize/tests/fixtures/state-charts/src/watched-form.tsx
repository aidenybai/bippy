import { useForm } from "react-hook-form";

interface Values {
  plan: "free" | "pro";
}

export const PlanForm = () => {
  const { register, watch } = useForm<Values>({ defaultValues: { plan: "free" } });
  const plan = watch("plan");
  return (
    <form>
      <select {...register("plan")}>
        <option value="free">Free</option>
        <option value="pro">Pro</option>
      </select>
      {plan === "pro" ? <p>Billed monthly</p> : <p>No charge</p>}
    </form>
  );
};
