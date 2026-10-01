import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { SecondFactor } from "./second-factor";

interface AuthResult {
  status: "ok" | "mfa-required";
  methods: string[];
}

const signIn = async (email: string): Promise<AuthResult> => ({
  status: email.endsWith("@example.com") ? "mfa-required" : "ok",
  methods: ["totp", "sms"],
});

const resendCode = async (): Promise<void> => {};

export const App = () => {
  const login = useMutation({ mutationKey: ["login"], mutationFn: signIn });
  const resend = useMutation({ mutationKey: ["resend-code"], mutationFn: resendCode });
  const logout = useMutation({ mutationFn: async () => {} });
  const { mutate } = login;
  useEffect(() => {
    mutate("ada@example.com");
  }, [mutate]);
  if (login.data?.status === "mfa-required") {
    return (
      <SecondFactor methods={login.data.methods} isResending={resend.isPending}>
        {resend.isIdle ? <button type="button">resend</button> : <output>sent</output>}
      </SecondFactor>
    );
  }
  return (
    <form>
      <input name="email" />
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? "signing in" : "sign in"}
      </button>
      {logout.isSuccess ? <p>signed out</p> : null}
    </form>
  );
};
