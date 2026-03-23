import Navigation from '../components/Navigation';
import { Link } from 'react-router-dom';
//import '../Main.css';
import '../confirmationPage.css';

// sample python script and JSON config for testing
const samplePythonScript = `import time

def main():
    print("Starting test run...")
    time.sleep(2)
    print("Test run completed!")`
;

const sampleJsonConfig = JSON.stringify({ 
    "test_name": "Sample Test",
    "duration": 120
});

// Display both the Python script and the JSON configuration
const DisplayCard = ({title, content}) => (
    <div className="Display-Card">
        <div className="Card-Title">{title}</div>
        <div className="Card-Container">
            <pre><code>{content}</code></pre>
        </div>
    </div>
);

const Confirmation = ({pythonScript = samplePythonScript, jsonConfig = sampleJsonConfig, onConfirm, onReturn = "/Dashboard"}) => {
    return(
     <>
        <Navigation />
        <div className="Confirmation-Page">
            <div className="Confirmation-Box">
                <h2 className = "Title">You are about to start a new Test Run</h2>
                <p>Confirm the following before proceeding</p>

                <div className="Card-Content">
                    <DisplayCard title="Script" content={pythonScript} />
                    <DisplayCard title="Config" content={jsonConfig} />
                </div>

                <div className="Button-Group">
                    <Link to = "/Dashboard">
                        <button className="Button Return">Return</button>
                    </Link>
                    <button className="Button Confirm" onClick={onConfirm}>Confirm</button> {/* Awaiting for page to be completed to implement functionality */}
                </div>
            </div>
        </div>
    </>
    );
};

export default Confirmation;