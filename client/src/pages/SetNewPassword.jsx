import Navigation from '../components/Navigation';
import '../SetNewPassword.css';
import '../NavBar.css';

const SetNewPassword = () => {
  return(
    <>
      <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <h1 className="set-new-password-heading">Set New Password</h1>
            <div className="set-new-password-info-fields">
              <h2 className="value-text">New Password</h2>
              <input className="set-new-password-value-box" type="password" placeholder="New Password" />
              <h2 className="value-text">Confirm New Password</h2>
              <input className="set-new-password-value-box" type="password" placeholder="Confirm New Password" />
              <button className="set-new-password-button">
                Set Password
              </button>
            </div>
          </section>
        </main>
    </>
  );
};

export default SetNewPassword;