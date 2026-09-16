import Navigation from "../components/Navigation";
import "../LandingPage.css";
import "../NavBar.css";
import { Link } from "react-router-dom";

const LandingPage = () => {
    return (
        <>
        <Navigation />

        <div className="landing-page">
            <h1 className="landing-title">Welcome to DockVision</h1>

            <p className="landing-text">
                How would you like to get started?
            </p>

            <p className="landing-instructions">
                Generate dummy test files to try out DockVision or upload your own files to run a custom test.
            </p>

            <div className="landing-buttons">
                <button className="landing-button">Generate</button>  

                <button className="landing-button">Upload</button>
            </div>

            <p className="landing-toAbout">
                If you would like more information on DockVision, <Link to="/about"> click here</Link>.
            </p>
        </div>

        </>
    );
};

export default LandingPage;
