import Navigation from '../components/Navigation';
import uploadIcon from '../assets/uploadIcon.png';
import executeIcon from '../assets/executeIcon.png';
import viewResultsIcon from '../assets/viewResultsIcon.png';
import '../Main.css';

const About = () => {
  return (
    <>
      <Navigation />
      <main className="about-page">
        {/* Section 1 - Hero */}
        <section className="about-hero">
          <h1 className="about-title">About DockVision</h1>
          <p className="about-description">
            DockVision is a web-based platform for running automated tests and viewing
            results in one place.
          </p>
        </section>

        {/* Section 2 - Feature Overview */}
        <section className="about-features">
          <div className="feature-card feature-card-large">
            <div className="feature-image-placeholder">Image</div>
            <h2>Automated Testing</h2>
            <p>
              Upload runner scripts and configuration files to start test runs
              in a controlled environment.
            </p>
          </div>

          <div className="feature-card feature-card-large">
            <div className="feature-image-placeholder">Image</div>
            <h2>Real-Time Monitoring</h2>
            <p>
              Track logs, screenshots, and execution progress while tests are
              running.
            </p>
          </div>
        </section>

        {/* Section 3 - How It Works */}
        <section className="about-workflow">
          <div className="section-heading">
            <h2>How It Works</h2>
            <p>Three simple steps from upload to results.</p>
          </div>

          <div className="workflow-card">
            <div className="workflow-icon-placeholder">
              <img src={uploadIcon} alt="Upload icon" className="workflow-icon" />
            </div>
            <div className="workflow-text">
              <h3>1. Upload</h3>
              <p>
                Add your runner script and configuration file to create a new
                test run.
              </p>
            </div>
          </div>

          <div className="workflow-card">
            <div className="workflow-icon-placeholder">
              <img src={executeIcon} alt="Execute icon" className="workflow-icon" />
            </div>
            <div className="workflow-text">
              <h3>2. Execute</h3>
              <p>
                DockVision prepares the test environment and begins running the test
                process.
              </p>
            </div>
          </div>

          <div className="workflow-card">
            <div className="workflow-icon-placeholder">
              <img src={viewResultsIcon} alt="View Results icon" className="workflow-icon" />
            </div>
            <div className="workflow-text">
              <h3>3. View Results</h3>
              <p>
                Review progress, logs, screenshots, and final output in a single
                interface.
              </p>
            </div>
          </div>
        </section>

        {/* Section 5 - Team */}
        <section className="about-team">
          <div className="section-heading">
            <h2>Meet the Team</h2>
            <p>Built by 26niorDevs.</p>
          </div>

          <div className="team-grid">
            <div className="team-member">Raeshon Minnifield</div>
            <div className="team-member">Brendan Nichols</div>
            <div className="team-member">Dann Manganti</div>
            <div className="team-member">Ashanti Momon</div>
            <div className="team-member">Johnathan Castaneda</div>
            <div className="team-member">Michael Normile</div>
            <div className="team-member">Caleb Lewis</div>
            <div className="team-member">Anton Lyaver</div>
          </div>
        </section>
      </main>
    </>
  );
};

export default About;