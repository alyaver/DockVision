import Navigation from '../components/Navigation';
import { Link, useLocation } from 'react-router-dom';
import '../confirmationPage.css';

const CURRENT_RUN_STORAGE_KEY = 'dockvision-current-run';

// sample python script and JSON config for testing
const samplePythonScript = `import time

def main():
    print("Starting test run...")
    time.sleep(2)
    print("Test run completed!")`;

const sampleJsonConfig = JSON.stringify(
  {
    test_name: 'Sample Test',
    duration: 120,
  });

function readStoredRun() {
  try {
    const rawValue = sessionStorage.getItem(CURRENT_RUN_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

// Display both the Python script and the JSON configuration
const DisplayCard = ({ title, content }) => (
  <div className="Display-Card">
    <div className="Card-Title">{title}</div>
    <div className="Card-Container">
      <pre><code>{content}</code></pre>
    </div>
  </div>
);

const Confirmation = ({
  pythonScript = samplePythonScript,
  jsonConfig = sampleJsonConfig,
  onConfirm,
  onReturn = '/Dashboard',
}) => {
  const location = useLocation();
  const storedRun = readStoredRun();

  const testName = location.state?.testName || storedRun?.testName || 'Untitled Test Run';
  const runId = location.state?.runId || storedRun?.runId || null;
  const configFileName = location.state?.configFileName || storedRun?.configFileName || 'Sample Config';
  const configContent = location.state?.configContent || storedRun?.configContent || jsonConfig;

  return (
    <>
      <Navigation />
      <div className="Confirmation-Page">
        <div className="Confirmation-Box">
          <h2 className="Title">You are about to start a new Test Run</h2>
          <p>Confirm the following before proceeding</p>
          <p><strong>Test Run Name:</strong> {testName}</p>
          {runId && <p><strong>Prepared Run ID:</strong> {runId}</p>}

          <div className="Card-Content">
            <DisplayCard title="Script" content={pythonScript} />
            <DisplayCard title={`Config (${configFileName})`} content={configContent} />
          </div>

          <div className="Button-Group">
            <Link to="/Dashboard">
              <button className="Button Return">Return</button>
            </Link>
            <button className="Button Confirm" onClick={onConfirm}>
              Confirm
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Confirmation;
