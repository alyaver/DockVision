import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import TitlePage from "./pages/TitlePage.jsx";
import About from "./pages/About.jsx";
import Contact from "./pages/Contact.jsx";
import TestPage from "./pages/running-test/TestPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Confirmation from "./pages/Confirmation.jsx";
import ConfigurationSettings from "./pages/ConfigurationSettings.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import SetNewPassword from "./pages/SetNewPassword.jsx";
import SignIn from "./pages/SignIn.jsx";
import Registration from "./pages/Registration.jsx";

/**
 * Central router.
 *
 * Cleanup decisions:
 * - Standardize on lowercase routes.
 * - Keep a few aliases so older links do not immediately break.
 * - Route reset links to SetNewPassword using both /set-new-password and /reset-password.
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
<<<<<<< HEAD
        <Route path="/login" element={<SignIn />} />
        <Route path="/Login" element={<SignIn />} />

        <Route path="/register" element={<Register />} />
        <Route path="/Register" element={<Register />} />
        <Route path="/registration" element={<Register />} />

        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-new-password" element={<SetNewPassword />} />
        <Route path="/reset-password" element={<SetNewPassword />} />
=======
        <Route path="/registration" element={<Registration />} />
>>>>>>> origin/DOCV-183-registration-page
      </Routes>
    </Router>
  );
}

export default App;