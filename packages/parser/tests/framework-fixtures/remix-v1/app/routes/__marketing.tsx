import { Outlet } from "@remix-run/react";

export default function Marketing() {
  return (
    <div className="marketing">
      <Outlet />
    </div>
  );
}
