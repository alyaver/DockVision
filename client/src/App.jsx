import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import TitlePage from "./pages/TitlePage.jsx";
import About from "./pages/About.jsx";
import Contact from "./pages/Contact.jsx";
import TestPage from "./pages/running-test/TestPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Confirmation from "./pages/Confirmation.jsx";
import ConfigurationSettings from "./pages/ConfigurationSettings.jsx";
import Register from "./components/Registration.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import SetNewPassword from "./pages/SetNewPassword.jsx";
import SignIn from "./pages/SignIn.jsx";

/**
 * Central router.
 *
 * Decisions:
 * - Keep lowercase primary routes.
 * - Keep compatibility aliases where useful.
 * - Route /registration and /register to the same Register page.
 * - Do not introduce a second competing Registration page component.
 */
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<TitlePage />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/confirmation" element={<Confirmation />} />
        <Route path="/configuration-settings" element={<ConfigurationSettings />} />
        <Route path="/running-test" element={<TestPage />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/Login" element={<SignIn />} />
        <Route path="/Register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-new-password" element={<SetNewPassword />} />
        <Route path="/reset-password" element={<SetNewPassword />} />
      </Routes>
    </Router>
  );
}

export default App;