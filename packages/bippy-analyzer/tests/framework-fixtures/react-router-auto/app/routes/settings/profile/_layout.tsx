import { Outlet } from "react-router";

export default function ProfileLayout() {
  return (
    <div className="profile">
      <Outlet />
    </div>
  );
}
