import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ConfigurationSettings from "./pages/configurationsettings";
import Dashboard from "./pages/dashboard";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/configuration-settings" element={<ConfigurationSettings />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/configuration-settings" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;