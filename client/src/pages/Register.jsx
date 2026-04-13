import Navigation from "../components/Navigation";
import "../Title.css";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Simple splash/title page.
 * Redirect target is normalized to lowercase to match App.jsx.
 */
const TitlePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/dashboard");
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <>
      <Navigation />
      <main className="title-page">
        <div className="title-page-box">
          <h1 className="title-page-heading">DockVision</h1>
        </div>
      </main>
    </>
  );
};

export default TitlePage;