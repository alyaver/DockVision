import {Link} from "react-router-dom";
import {useState} from "react";
import Navigation from '../components/Navigation';
import '../SignIn.css';
import '../NavBar.css';

const SignIn = () => {
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");

  const validExtensions = [".com", ".org", ".net", ".gov", ".edu", ".mil"];
  
  const emailParts = email.split("@");
  const localPart = emailParts.length === 2 ? emailParts[0] : "";
  const domainPart = emailParts.length === 2 ? emailParts[1] : "";

  const passRules = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "Contains a number", valid: /\d/.test(password) },
    { label: "Has an uppercase letter", valid: /[A-Z]/.test(password) },
  ];

  const emailRules = [
    { label: "Contains exactly one @ symbol", valid: emailParts.length === 2 },
    { label: "Starts with local-part", valid: localPart.length > 0 },
    { label: "Ends with domain-part", valid: domainPart.length > 0 },
    { label: "Local-part is at most 64 characters", valid: localPart.length > 0 && localPart < 65 },
    { label: "Local-part does not start or end with .",
      valid:
        localPart.length > 0 &&
        !localPart.startsWith(".") &&
        !localPart.endsWith(".")
    },
    { label: "Domain-part is at most 255 characters", valid: domainPart.length > 0 && domainPart < 256 },
    { label: "Domain-part must end with a valid extension", valid: validExtensions.some((ext) => domainPart.endsWith(ext)) }
  ];

  const isPasswordValid = passRules.every((rule) => rule.valid);
  const isEmailValid = emailRules.every((rule) => rule.valid);

  return(
    <>
      <Navigation />
        <main className="sign-in-page">
          <section className="sign-in-hero">
            <h1 className="sign-in-heading">Sign In</h1>
            <div className="sign-in-info-fields">
              <h2 className="value-text">Email</h2>
              <input className="sign-in-value-box" type="text" placeholder="Email" />

              <h2 className="value-text">Password</h2>
              <input className="sign-in-value-box" type="password" value ={password} 
              onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              <button className="sign-in-button">
                Sign In
              </button>
              <Link to="/forgot-password" className="sign-in-secondary-link">Forgot Password</Link>
              <Link to="/registration" className="sign-in-secondary-link">Create Account</Link>
            </div>
          </section>
        </main>
    </>
  );
};

export default SignIn;