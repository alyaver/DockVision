import Navigation from "../components/Navigation";
import "../Title.css";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import logo2 from "../assets/logo2.png";

/**
 * Simple splash/title page.
 * Redirect target is normalized to lowercase to match App.jsx.
 */
const TitlePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/about");
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <>
      <Navigation />
      <main className="title-page">
        <div className="title-page-box">
          <img src={logo2} alt="DockVision" className="title-page-logo" />
        </div>
      </main>
    </>
  );
};

export default TitlePage;