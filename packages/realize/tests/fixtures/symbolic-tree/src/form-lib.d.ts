declare module "form-lib" {
  export interface Form<Values> {
    handleSubmit: (onValid: (values: Values) => void) => (event: unknown) => void;
    register: (name: keyof Values) => { name: string };
    formState: { errors: Partial<Record<keyof Values, { message?: string }>> };
  }
  export const useForm: <Values>() => Form<Values>;
}
