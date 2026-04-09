import Navigation from '../components/Navigation';
import { Link, useLocation } from 'react-router-dom';
import '../confirmationPage.css';

const samplePythonScript = `import time

def main():
    print("Starting test run...")
    time.sleep(2)
    print("Test run completed!")`;

const DisplayCard = ({ title, content }) => (
  <div className="Display-Card">
    <div className="Card-Title">{title}</div>
    <div className="Card-Container">
      <pre><code>{content}</code></pre>
    </div>
  </div>
);

const Confirmation = ({ onConfirm }) => {
  const location = useLocation();

  const testName = location.state?.testName || 'Untitled Test Run';
  const runId = location.state?.runId || null;
  const configFileName = location.state?.configFileName || 'No config uploaded';
  const configContent = location.state?.configContent || 'No config preview available.';

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
            <DisplayCard title="Script" content={samplePythonScript} />
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
