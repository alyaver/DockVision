import {Link, useNavigate } from "react-router-dom";
import {useState} from "react";
import Navigation from '../components/Navigation';
import '../Registration.css';
import '../NavBar.css';


function getPasswordStrength(password) {
  const checks = {
    length:     password.length >= 8,
    longEnough: password.length >= 12,
    uppercase:  /[A-Z]/.test(password),
    lowercase:  /[a-z]/.test(password),
    number:     /\d/.test(password),
    symbol:     /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const levels = [
    { label: '',            pct: 0,   color: '#ccc'    },
    { label: 'Very weak',   pct: 16,  color: '#E24B4A' },
    { label: 'Weak',        pct: 32,  color: '#E24B4A' },
    { label: 'Fair',        pct: 52,  color: '#EF9F27' },
    { label: 'Good',        pct: 72,  color: '#639922' },
    { label: 'Strong',      pct: 88,  color: '#1D9E75' },
    { label: 'Very strong', pct: 100, color: '#1D9E75' },
  ];
  return { checks, score, level: password.length === 0 ? levels[0] : levels[Math.max(1, score)] };
}


const Register = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm_password, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [peekPassword, setPeekPassword] = useState(false);
  const [peekConfirm, setPeekConfirm] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false); 


  const navigate = useNavigate();
  
  const handlePasswordChange = (e, setter, peekSetter) => {
    setter(e.target.value);
    peekSetter(true);
    setTimeout(() => peekSetter(false), 250);
  };

  const { checks: pwChecks, score: pwScore, level: pwLevel } = getPasswordStrength(password);
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
              <div className="password-wrapper">
              <input className="register-value-box" type={showPassword || peekPassword ? "text" : "password"} value ={password} onChange={(e) => handlePasswordChange(e, setPassword, setPeekPassword)} placeholder="Password" />
              <button className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
              </div>

            <div className="password-strength-checker">
              {password.length > 0 && (
                      <>
                        <div className="strength-bar-track">
                        {[1, 2, 3, 4].map((seg) => {
                            const filledCount = (
                              pwScore <= 2 ? 1 :
                              pwScore <= 3 ? 2 :
                              pwScore <= 4 ? 3 : 4
                            );
                            const color = (
                              pwScore <= 2 ? '#E24B4A' :
                              pwScore <= 3 ? '#EF9F27' :
                              pwScore <= 4 ? '#639922' :
                                            '#1D9E75'
                            );
                            return (
                              <div
                                key={seg}
                                className="strength-bar-segment"
                                style={{ background: filledCount >= seg ? color : '#e0e0e0' }}
                              />
                            );
                          })}
                        </div>
                        <div className="strength-label-row">
                          <span className="strength-label" style={{ color: pwLevel.color }}>
                            {pwLevel.label}
                          </span>
                          <span className="strength-score">{pwScore}/6</span>
                        </div>
                        <div className="strength-rules">
                          {[
                            { label: '8+ characters',    pass: pwChecks.length     },
                            { label: 'Uppercase letter',  pass: pwChecks.uppercase  },
                            { label: 'Lowercase letter',  pass: pwChecks.lowercase  },
                            { label: 'Number',            pass: pwChecks.number     },
                            { label: 'Special character', pass: pwChecks.symbol     },
                            { label: '12+ characters for Strong Password',    pass: pwChecks.longEnough },
                          ].map((r, i) => (
                            <div key={i} className={`strength-rule ${r.pass ? 'pass' : ''}`}>
                              <span className="strength-rule-dot" />
                              {r.label}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
              </div>
              {password.length > 0 && !isPasswordValid && (
                <div className="error-text">
                  {passRules.filter(rule => !rule.valid).map((rule, index) => (<p key={index}>{rule.label}</p>))}
                </div>
              )}

              <h2 className="value-text">Confirm Password</h2>

              <div className="password-wrapper">
              <input className="register-value-box" type={showConfirm || peekConfirm ? "text" : "password"} value={confirm_password} onChange={(e) => handlePasswordChange(e, setConfirmPassword, setPeekConfirm)} placeholder="Confirm Password" />
              <button className="password-toggle" onClick={() => setShowConfirm(!showConfirm)}>
                {showConfirm ? 'Hide' : 'Show'}
              </button>
              </div>
              
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