export const Widget = ({ label, value }) => (
  <li>
    <span>{label}</span>
    <strong>{value < 10 ? "low" : "high"}</strong>
  </li>
);
