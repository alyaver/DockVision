import {Link} from "react-router-dom";
import Navigation from '../components/Navigation';
import '../SignIn.css';
import '../NavBar.css';

const SignIn = () => {
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
              <input className="sign-in-value-box" type="text" placeholder="Password" />
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