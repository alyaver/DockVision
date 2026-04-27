import Navigation from '../components/Navigation';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import '../SetNewPassword.css';
import '../NavBar.css';

const SetNewPassword = () => {
  const [isValid, setIsValid] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      setIsValid(false);
      setError('No token provided in URL');
      return;
    }

    fetch(`http://localhost:5000/api/auth/reset/validate?token=${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) {
          setIsValid(true);
        } else {
          setIsValid(false);
          setError(data.message || 'Invalid token');
        }
      })
      .catch(err => {
        setIsValid(false);
        setError('Failed to validate token');
      });
  }, []);

 const handleSetPassword = async () => {
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const token = new URLSearchParams(window.location.search).get('token');
    setLoading(true);

    try {
      const res = await fetch('http://localhost:5000/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.message || 'Reset failed. Please try again.');
        return;
      }

      navigate('/Login');

    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isValid === null) {
    return (
      <>
        <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <div className="loading">Validating token...</div>
          </section>
        </main>
      </>
    );
  }

  if (!isValid) {
    return (
      <>
        <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <h1 className="set-new-password-heading">Invalid Reset Link</h1>
            <div className="error-panel">
              <p>{error}</p>
              <Link to="/forgot-password" className="error-link">Back to Forgot Password</Link>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
        <main className="set-new-password-page">
          <section className="set-new-password-hero">
            <h1 className="set-new-password-heading">Set New Password</h1>
            <div className="set-new-password-info-fields">
              <h2 className="value-text">New Password</h2>
              <input className="set-new-password-value-box" type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password"
            />
              <h2 className="value-text">Confirm New Password</h2>
              <input className="set-new-password-value-box" type="password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm New Password"
              />
              <button className="set-new-password-button" onClick={handleSetPassword} disabled = {loading || !newPassword || !confirmPassword}>
                {loading ? 'Saving...':'Set Password'}
              </button>
            <Link to="/login" className="back-link">Back to Sign In</Link>
            </div>
          </section>
        </main>
    </>
  );
};

export default SetNewPassword;