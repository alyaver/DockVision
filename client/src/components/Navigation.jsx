import { Link, useLocation } from 'react-router-dom';

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
        {location.pathname === '/' && (
          <li>
            <Link to="/about" className="hover-underline">About</Link>
          </li>
        )}

        <li>
          <Link to="/contact" className="hover-underline">Contact</Link>
        </li>
        <li>
          <Link to="/login" className="nav-button">Sign in</Link>
        </li>
        <li>
          <Link to="/register" className="nav-button nav-button-dark">Register</Link>
        </li>
      </ul>
    </nav>
  );
};

export default Navigation;