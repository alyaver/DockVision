import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "../NavBar.css";

/**
 * Use relative /api calls so requests go through the Vite proxy.
 */
const API_BASE_URL = "/api";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      try {
        const response = await fetch(`${API_BASE_URL}/me`, {
          method: "GET",
          credentials: "include",
        });

        if (!isMounted) return;

        if (!response.ok) {
          setUser(null);
          return;
        }

        const data = await response.json();
        setUser(data.user || null);
      } catch (error) {
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsCheckingAuth(false);
        }
      }
    }

    loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, [location.pathname]);

  async function handleLogout() {
    try {
      await fetch(`${API_BASE_URL}/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      setUser(null);
      navigate("/sign-in");
    }
  }

  return (
    <nav className="nav-bar">
      <div className="nav-logo">
        <Link to="/">
          <img src="/src/assets/logo.png" alt="Logo" />
        </Link>
      </div>

      <ul className="nav-links">
        {location.pathname !== "/about" && (
          <li>
            <Link to="/about" className="hover-underline">
              About
            </Link>
          </li>
        )}

        {location.pathname !== "/contact" && (
          <li>
            <Link to="/contact" className="hover-underline">
              Contact
            </Link>
          </li>
        )}

        {!isCheckingAuth &&
          (user ? (
            <>
              <li>
                <Link to="/profile" className="nav-button">
                  Profile
                </Link>
              </li>
              <li>
                <button
                  type="button"
                  className="nav-button nav-button-dark"
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              </li>
            </>
          ) : (
            <>
              <li>
                <Link to="/sign-in" className="nav-button">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/registration" className="nav-button nav-button-dark">
                  Register
                </Link>
              </li>
            </>
          ))}
      </ul>
    </nav>
  );
};

export default Navigation;