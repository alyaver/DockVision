import Navigation from '../components/Navigation';
import '../NavBar.css';
import '../ForgotPassword.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false);

  const handleResetPassword = async () => {
    setLoading(true);
    try{
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        setMessage("Link Sent! Check Your Email.")
      }else{
        setMessage("Somthing went wrong! Try Again!")
      }
    }catch (err){
      setMessage("Network error. Try Again!")
    }
    };

return(
  <>
  <Navigation />
  <main className = "forgotPassword">
    <section className="forgotPassword-hero">
      <h1 className="forgotPassword-heading">Reset Password</h1>
        <div className="resetPassword">
          <div className="email-info">
            <label className="email-label" htmlFor="emailAddress" >Email </label> 
            <input className="email-box" type="text" id="emailAddress" placeholder="Enter E-mail" value={email} onChange={(e) => setEmail(e.target.value)}/>
          </div>
          {message && <p className= "reset-message">{message}</p>}
          <div className="button-group">
              <button className="cancel-Button" type="button" onClick={() => navigate('/sign-in')}>Cancel </button>  {/*redirect to signin page */}
              <button className="submit-Button" type="button" onClick={handleResetPassword} disabled={loading}>{loading ? "Sent" :"Reset Password"}</button> {/*needs to validate user and then send email to user containing link to resetpassword page. */}
          </div>
        </div>
    </section>
  </main>
  </>
  );
};

export default ForgotPassword;