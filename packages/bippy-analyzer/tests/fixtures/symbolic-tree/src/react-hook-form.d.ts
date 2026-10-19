declare module "react-hook-form" {
  export interface UseFormReturn<Values> {
    register: (name: keyof Values) => { name: string };
    watch: <Name extends keyof Values>(name: Name) => Values[Name];
  }
  export const useForm: <Values>(options?: {
    defaultValues?: Partial<Values>;
  }) => UseFormReturn<Values>;
}
