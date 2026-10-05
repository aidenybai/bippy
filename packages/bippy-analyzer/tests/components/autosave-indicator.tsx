import { useCallback, useEffect, useRef, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";

interface DraftValues {
  amount: number;
  total: number;
}

const writeDraft = async (payload: unknown): Promise<boolean> => {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return digest.byteLength > 0;
};

const Totals = () => {
  const { setValue } = useFormContext<DraftValues>();
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    setIsReady(true);
  }, []);
  useEffect(() => {
    if (isReady) setValue("total", 42);
  }, [isReady, setValue]);
  return <output>total</output>;
};

const Indicator = ({ savedAt, isPending }: { savedAt: number | null; isPending: boolean }) => {
  if (isPending) return <i>saving</i>;
  if (!savedAt) return null;
  const secondsAgo = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  return <b>{secondsAgo < 60 ? "just now" : `${Math.floor(secondsAgo / 60)}m`}</b>;
};

const AutosaveIndicator = () => {
  const form = useForm<DraftValues>({ defaultValues: { amount: 1, total: 0 } });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isPending, setIsPending] = useState(false);
  const pendingDraft = useRef<unknown>(null);

  const flush = useCallback(() => {
    if (pendingDraft.current === null) return;
    const payload = pendingDraft.current;
    pendingDraft.current = null;
    void writeDraft(payload).then((isWritten) => {
      if (isWritten) setSavedAt(Date.now());
    });
    setIsPending(false);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = form.watch((value) => {
      pendingDraft.current = value;
      setIsPending(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 50);
    });
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
      flush();
    };
  }, [form.watch, flush]);

  return (
    <FormProvider {...form}>
      <section>
        <Totals />
        <Indicator savedAt={savedAt} isPending={isPending} />
      </section>
    </FormProvider>
  );
};

export default AutosaveIndicator;
