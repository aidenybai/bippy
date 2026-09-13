import { useEffect } from "react";
import { FormProvider, useForm, useFormContext, useWatch } from "react-hook-form";

interface DraftValues {
  title: string;
}

const readDraft = async (): Promise<DraftValues | null> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("draft"));
  return digest.byteLength > 0 ? null : { title: "restored" };
};

const isFilled = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const hasError = (errors: object, path: string): boolean => {
  let node: unknown = errors;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return false;
  }
  return Boolean(node);
};

const Marker = () => {
  const {
    control,
    formState: { errors },
  } = useFormContext<DraftValues>();
  const [title] = useWatch({ control, name: ["title"] });
  if (hasError(errors, "title")) return <u>invalid</u>;
  return isFilled(title) ? <b>complete</b> : <i>empty</i>;
};

const DraftForm = () => {
  const form = useForm<DraftValues>({ defaultValues: { title: "" }, mode: "onTouched" });
  useEffect(() => {
    let isActive = true;
    readDraft().then((draft) => {
      if (isActive && draft) form.reset(draft);
    });
    return () => {
      isActive = false;
    };
  }, []);
  return (
    <FormProvider {...form}>
      <Marker />
    </FormProvider>
  );
};

export default function HookFormDraft() {
  return <DraftForm />;
}

export const minCoverage = 0.5;
