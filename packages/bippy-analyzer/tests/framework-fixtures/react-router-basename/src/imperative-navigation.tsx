import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";

declare global {
  interface Window {
    authenticated?: boolean;
  }
}

const Home = () => {
  const navigate = useNavigate();
  useEffect(() => navigate("/login"), [navigate]);
  return <main />;
};

const Login = () => <aside />;
const Private = () => <section />;
const authenticated = window.authenticated;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/redirect" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/guarded" element={authenticated ? <Navigate to="/private" /> : <Login />} />
      <Route path="/private" element={authenticated ? <Private /> : <Navigate to="/guarded" />} />
    </Routes>
  </BrowserRouter>,
);
