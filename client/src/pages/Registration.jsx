import {Link, useNavigate } from "react-router-dom";
import {useState} from "react";
import Navigation from '../components/Navigation';
import '../Registration.css';
import '../NavBar.css';

const Register = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm_password, setConfirmPassword] = useState("");

  const navigate = useNavigate();

  const validExtensions = [".com", ".org", ".net", ".gov", ".edu", ".mil"];
  
  const emailParts = email.split("@");
  const localPart = emailParts.length === 2 ? emailParts[0] : "";
  const domainPart = emailParts.length === 2 ? emailParts[1] : "";

  const nameRules = [
    { label: "Name must be 6 to 30 characters", valid: name.length >= 6 && name.length <= 30 },
    { label: "Name must only contain alphanumeric characters and spaces", valid: /^[a-zA-Z0-9 ]+$/.test(name) },
  ];

  const passRules = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Contains at least 1 number", valid: /\d/.test(password) },
    { label: "Contains at least 1 letter", valid: /[a-zA-Z]/.test(password) },
  ];

  const confirmPassRules = [
    { label: "Confirm Password must match Password", valid: confirm_password === password},
  ];

  const emailRules = [
    { label: "Contains exactly one @ symbol", valid: emailParts.length === 2 },
    { label: "Starts with local-part", valid: localPart.length > 0 },
    { label: "Ends with domain-part", valid: domainPart.length > 0 },
    { label: "Local-part is at most 64 characters", valid: localPart.length > 0 && localPart.length < 65 },
    { label: "Local-part does not start or end with .",
      valid:
        localPart.length > 0 &&
        !localPart.startsWith(".") &&
        !localPart.endsWith(".")
    },
    { label: "Domain-part is at most 255 characters", valid: domainPart.length > 0 && domainPart.length < 256 },
    { label: "Domain-part must end with a valid extension", valid: validExtensions.some((ext) => domainPart.endsWith(ext)) }
  ];

  const isNameValid = nameRules.every((rule) => rule.valid);
  const isEmailValid = emailRules.every((rule) => rule.valid);
  const isPasswordValid = passRules.every((rule) => rule.valid);
  const isConfirmPasswordValid = confirmPassRules.every((rule) => rule.valid);

  const isRegistrationValid = isNameValid && isEmailValid && isPasswordValid && isConfirmPasswordValid;

  return(
    <>
      <Navigation />
        <main className="register-page">
          <section className="register-hero">
            <h1 className="register-heading">Register</h1>
            <div className="register-info-fields">
              <h2 className="value-text">Name</h2>
              <input className="register-value-box" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />

              {name.length > 0 && !isNameValid && (
                <div className="error-text">
                  {nameRules.filter(rule => !rule.valid).map((rule, index) => (<p key={index}>{rule.label}</p>))}
                </div>
              )}
              
              <h2 className="value-text">Email</h2>
              <input className="register-value-box" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />

              {email.length > 0 && !isEmailValid && (
                <div className="error-text"><p>Error: Invalid Email</p></div>
              )}

              <h2 className="value-text">Password</h2>
              <input className="register-value-box" type="password" value ={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />

              {password.length > 0 && !isPasswordValid && (
                <div className="error-text">
                  {passRules.filter(rule => !rule.valid).map((rule, index) => (<p key={index}>{rule.label}</p>))}
                </div>
              )}

              <h2 className="value-text">Confirm Password</h2>
              <input className="register-value-box" type="password" value={confirm_password} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm Password" />

              {confirm_password.length > 0 && !isConfirmPasswordValid && (
                <div className="error-text">
                  {confirmPassRules.filter(rule => !rule.valid).map((rule, index) => (<p key={index}>{rule.label}</p>))}
                </div>
              )}

              <button className="register-button" type="button" onClick={() => navigate('/dashboard')} disabled={!isRegistrationValid} style={{ opacity: !isRegistrationValid ? 0.5 : 1, cursor: isRegistrationValid ? "pointer" : "not-allowed" }}>
                Create Account
              </button>
              <Link to="/forgot-password" className="register-secondary-link">Forgot Password</Link>
              <Link to="/sign-in" className="register-secondary-link">Sign In</Link>
            </div>
          </section>
        </main>
    </>
  );
};

export default Register;