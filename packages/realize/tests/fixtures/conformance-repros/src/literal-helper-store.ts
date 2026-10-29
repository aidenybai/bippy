let role = "guest";

export const getRole = () => role;

export const signIn = () => {
  role = "member";
};
