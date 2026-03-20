import Navigation from '../components/Navigation';
import autoTestImg from '../assets/autoTest.png';
import rtMonitoringImg from '../assets/rtMonitoring.png';
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
            <div className="feature-image-placeholder">
              <img src={autoTestImg} alt="Automated testing" className="feature-image" />
            </div>
            <h2>Automated Testing</h2>
            <p>
              Upload runner scripts and configuration files to start test runs
              in a controlled environment.
            </p>
          </div>

          <div className="feature-card feature-card-large">
            <div className="feature-image-placeholder">
              <img src={rtMonitoringImg} alt="Real-time monitoring" className="feature-image" />
            </div>
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
            <div className="team-member"><div className="team-avatar">RM</div><span>Raeshon Minnifield</span></div>
            <div className="team-member"><div className="team-avatar">BN</div><span>Brendan Nichols</span></div>
            <div className="team-member"><div className="team-avatar">DM</div><span>Dann Manganti</span></div>
            <div className="team-member"><div className="team-avatar">AM</div><span>Ashanti Momon</span></div>
            <div className="team-member"><div className="team-avatar">JC</div><span>Johnathan Castaneda</span></div>
            <div className="team-member"><div className="team-avatar">MN</div><span>Michael Normile</span></div>
            <div className="team-member"><div className="team-avatar">CL</div><span>Caleb Lewis</span></div>
            <div className="team-member"><div className="team-avatar">AL</div><span>Anton Lyaver</span></div>
          </div>
        </section>
      </main>
    </>
  );
};

export default About;