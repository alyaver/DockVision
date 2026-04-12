import { Link, useLocation } from 'react-router-dom';
import '../NavBar.css';

const Navigation = () => {
  const location = useLocation();

  return (
    <nav className="nav-bar">
      <div className="nav-logo">
        <Link to="/">
          <img src="/src/assets/logo.png" alt="Logo" />
        </Link>
      </div>

      <ul className="nav-links">
        {location.pathname !== '/about' && (
          <li>
            <Link to="/about" className="hover-underline">About</Link>
          </li>
        )}

        {location.pathname !== '/contact' && (
          <li>
            <Link to="/contact" className="hover-underline">Contact</Link>
          </li>
        )}
        
        <li>
          <Link to="/sign-in" className="nav-button">Sign in</Link>
        </li>
        <li>
          <Link to="/register" className="nav-button nav-button-dark">Register</Link>
        </li>
      </ul>
    </nav>
  );
};

export default Navigation;