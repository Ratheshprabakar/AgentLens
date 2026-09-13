import { Routes, Route, Navigate } from "react-router-dom";
import SessionsPage from "./pages/Sessions.tsx";
import SessionPage from "./pages/Session.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SessionsPage />} />
      <Route path="/sessions/:id" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
