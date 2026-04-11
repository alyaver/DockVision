import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TitlePage from './pages/TitlePage';
import About from './pages/About';
import Contact from './pages/Contact';
import TestPage from './pages/running-test/TestPage';
import Dashboard from './pages/Dashboard';
import Confirmation from './pages/Confirmation';
import ConfigurationSettings from "./pages/ConfigurationSettings.jsx";
import Register from "./pages/Register.jsx";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<TitlePage />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/running-test" element={<TestPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/confirmation" element={<Confirmation />} />
        <Route path="/configuration-settings" element={<ConfigurationSettings />} />
        <Route path="/Register" element={<Register />} />
      </Routes>
    </Router>
  );
}

export default App;