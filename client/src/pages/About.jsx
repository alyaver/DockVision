import Navigation from '../components/Navigation';
import autoTestImg from '../assets/aboutImages/autoTest.png';
import rtMonitoringImg from '../assets/aboutImages/rtMonitoring.png';
import uploadIcon from '../assets/aboutImages/uploadIcon.png';
import executeIcon from '../assets/aboutImages/executeIcon.png';
import viewResultsIcon from '../assets/aboutImages/viewResultsIcon.png';
import notepadIcon from '../assets/aboutImages/notepadIcon.png';
import '../About.css';

const About = () => {
  return (
    <>
      <Navigation />
      <main className="about-page">
        {/* Section 1 - Hero */}
        <section className="about-hero">
          <h1 className="about-title">About DockVision</h1>
          <p className="about-description">
            DockVision is a web-based platform for running automated tests, monitoring execution, 
            and viewing results in one place.
          </p>
          <p>
            Instead of manually coordinating every execution step,
            users can configure a task, submit it for execution, monitor
            its progress, and inspect the resulting logs, screenshots,
            and output artifacts through a centralized interface.
          </p>
        </section>

      {/*Section 2 - How to set up */}
        <section className="workflow-dependencies">
           <div className="section-heading">
            <h2>How to setup application environment</h2>
            <p>Two simple steps for setup</p>
          </div>

          <div className="workflow-card">
            <div className="workflow-text">
              <h3>1. Install the Prerequisites</h3>
              <p>
                Install and configure the dependencies required for application set-up:
              </p>
              <p>
                <b>PostgreSQL and Docker Desktop</b>
              </p>
            </div>
          </div>

          <div className="workflow-card">
            <div className="workflow-text">
              <h3>2. Set-up/Connect Database</h3>
              <p>
               DockVision requires a database to store application data, including user accounts and session information. 
               You must configure and connect your own database before using the application. PostgreSQL is the recommended database for DockVision, as it is the primary database used by the development team. 
               Other database systems may be compatible if they are configured correctly and supported by the application's database integration
              </p>
              <p>
              <b>Important:</b> DockVision does not automatically provide or host a database for you. 
              You are responsible for configuring your database connection and ensuring your database is available when the application runs. 
              Keep your database credentials private and never commit them to source control.
              </p>
              <h4>Before getting started:</h4>
              <p>Create or obtain access to a PostgreSQL database.
                Configure the database connection settings in the application's environment configuration.
                Ensure the database server is running and accessible to the application.
                Configure any required database tables or migrations before launching the application.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3 - Feature Overview */}
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


          {/* Existing Automated Testing and Real-Time Monitoring cards stay here */}

          {/* Built-In Notepad Workflow Card */}
          <div className="feature-card feature-card-large">
            <div className="feature-image-placeholder">
              <img
                src={notepadIcon}
                alt="Built-In Notepad workflow"
                className="feature-image"
              />
            </div>
            <h2>Built-In Notepad Workflow</h2>
            <p>
              Run supported Notepad automation tasks using DockVision's
              built-in task-plan workflow without supplying your own runner script.
            </p>

            <h3>How it works</h3>
            <ol>
              <li>Select Built-In Notepad.</li>
              <li>Provide a supported task plan.</li>
              <li>Configure the available run options.</li>
              <li>Confirm the task and monitor execution.</li>
              <li>Review the results, logs, and available screenshots.</li>
            </ol>
          </div>

          {/* Custom Runner Workflow Card */}
          <div className="feature-card feature-card-large">
            <div className="feature-image-placeholder">
              <img
                src={executeIcon}
                alt="Custom Runner workflow"
                className="feature-image"
              />
            </div>

            <h2>Custom Runner Workflow</h2>
            <p>
              Execute your own automation scripts through DockVision's
              custom-runner workflow.
            </p>

            <h3>How it works</h3>
            <ol>
              <li>Select Custom Runner.</li>
              <li>Upload a supported Python or PowerShell script.</li>
              <li>Provide a valid JSON configuration file.</li>
              <li>Configure the available run options.</li>
              <li>Submit the task and review its results.</li>
            </ol>

            <p>
              Custom runners use user-provided scripts and configuration files,
              which are separate from the built-in Notepad task-plan workflow.
            </p>
          </div>
        </section>

        {/* Section 4 - How It Works */}
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


          <div className="workflow-card">
            <div className="workflow-icon-placeholder">
             <img
                src={rtMonitoringImg}
                alt="Real-time test monitoring"
                className="feature-image"
              />
            </div>
            <div className="workflow-text">
              <h3>Monitor Your Runs</h3>
            <p>
              Follow task execution through DockVision's run
              interface. Review the available status information
              and execution logs to understand how a task is
              progressing.
            </p>

            <ul>
              <li>Track execution status and progress.</li>
              <li>Inspect available execution logs.</li>
              <li>Review screenshots captured during a run.</li>
              <li>Examine available output artifacts and results.</li>
            </ul>
            </div>
          </div>

          <div className="workflow-card">
            <div className="workflow-icon-placeholder">
             <img
                src={viewResultsIcon}
                alt="Test results"
                className="feature-image"
              />
            </div>
            <div className="workflow-text">
               <h3>Review Results and Artifacts</h3>
            <p>
              After execution, inspect the results made available
              for your run. Depending on the execution workflow,
              these may include task metadata, result information,
              logs, screenshots, and other generated output files.
            </p>
            <p>
              Artifact availability depends on the task and its
              execution outcome. Use the run interface to access
              the information provided by the application.
            </p>
            <p>
              If you need to save results outside DockVision,
              consult the application's available artifact
              download or export functionality. Local export
              should only be used where the installed
              implementation explicitly supports it.
            </p>
            </div>
          </div>
        </section>

        {/* Section 6 - Team */}
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