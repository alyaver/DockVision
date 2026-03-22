import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TitlePage from './pages/TitlePage';
import About from './pages/About';
import Contact from './pages/Contact';
import TestPage from './pages/running-test/TestPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<TitlePage />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/running-test" element={<TestPage />} />
      </Routes>
    </Router>
  );
}

export default App;