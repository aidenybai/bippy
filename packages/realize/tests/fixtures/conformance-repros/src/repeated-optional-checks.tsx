interface Dialog {
  name: "link" | "export";
}

export const DialogBar = ({ dialog }: { dialog: Dialog | null }) => {
  if (dialog?.name === "link") return <p>Linking</p>;
  return <div>{dialog?.name !== "link" ? <span>Toolbar</span> : null}</div>;
};
