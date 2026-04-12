import {Link} from "react-router-dom";
import {useState} from "react";
import Navigation from '../components/Navigation';
import '../SignIn.css';
import '../NavBar.css';

const SignIn = () => {
  const [password, setPassword] = useState("");

  const rules = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "Contains a number", valid: /\d/.test(password) },
    { label: "Has an uppercase letter", valid: /[A-Z]/.test(password) },
  ];

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