import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "../NavBar.css";

const API_BASE_URL = "/api/auth";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    function handleProfileUpdated(event) {
      if (event.detail && isMounted) {
        setUser(event.detail);
      }
    }

    window.addEventListener("dockvision:profile-updated", handleProfileUpdated);

    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/profile", {
          method: "GET",
          credentials: "include",
        });

        if (!isMounted) {
          return;
        }
        //distingushing between erros
        if(response.status === 401 || response.status === 403){
          setUser(null);

          const authenticatedPaths = [
            "/dashboard",
            "/configuration-settings",
            "/create-a-task",
            "/running-test",
            "/profile",
          ];

          const isAuthenticatedPath = authenticatedPaths.some(
              (path) =>
              location.pathname == path || location.pathname.startsWith('${path}/')
          );
          
          if (isAuthenticatedPath){
            navigate("/dashboard",{replace: true});
          }

          return;
        }
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
      window.removeEventListener("dockvision:profile-updated", handleProfileUpdated);
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
      sessionStorage.removeItem("dockvision-current-run");
      navigate("/login");
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
            {(location.pathname === "/about" || 
              location.pathname === "/contact" ||
              location.pathname === "/profile" ||
              location.pathname === "/")
            && (
              <li>
                <Link to="/dashboard" className="nav-button">
                Dashboard
                </Link>
              </li>
            )}

              <li>
                <Link to="/profile" className="nav-button nav-profile-link">
                  {user.has_avatar ? (
                    <img
                      className="nav-avatar"
                      src={`/api/profile/avatar?v=${encodeURIComponent(user.avatar_updated_at || "current")}`}
                      alt=""
                    />
                  ) : (
                    <span className="nav-avatar nav-avatar-fallback" aria-hidden="true">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span>Profile</span>
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
                <Link to="/login" className="nav-button">
                  Sign in
                </Link>
              </li>
              <li>
                <Link to="/register" className="nav-button nav-button-dark">
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