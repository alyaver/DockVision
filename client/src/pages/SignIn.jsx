import {Link, useNavigate} from "react-router-dom";
import {useState} from "react";
import Navigation from '../components/Navigation';
import '../SignIn.css';
import '../NavBar.css';

const SignIn = () => {
  const navigate = useNavigate()
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const handlingSignIn = async () =>{
    setLoading(true)
    setError("")
    try{
      const res = await fetch('/api/signIn',{
        method: 'POST',
        headers:{ 'Content-Type':'application/json'},
        body: JSON.stringify({email,password})
      })
      const data = await res.json()
      if (res.ok){
        localStorage.setItem('token', data.token)
        localStorage.setItem('user', JSON.stringify(data.user))
        navigate('/dashboard')
      }else{
        setError(data.message || 'Invalid credentials')
      }
    } catch (err) {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }
        
  

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
              <input className="sign-in-value-box" type="text" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}/>

              <h2 className="value-text">Password</h2>
              <input className="sign-in-value-box" type="password" value ={password} 
              onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              <button className="sign-in-button" onClick={handlingSignIn} disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
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