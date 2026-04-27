/**
 * Container for the sign-in route.
 *
 * Responsibilities:
 * - receive the normalized form payload from the presentational Login page
 * - call the backend auth endpoint that creates the session cookie
 * - forward remember-me so the backend can choose the correct session lifetime
 * - translate API failures into UI state before routing to the dashboard
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom"; 
import Login from "../pages/Login";

const API_BASE_URL = "/api/auth"; // updated base URL to match server route changes

export default function LoginContainer() {
  const [errorMessage, setErrorMessage] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const navigate = useNavigate(); 

  async function handleLogin(formData) {
    try {
      setErrorMessage("");
      setIsLocked(false);

      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        // Forward the remember-me choice through the live login entry point so
        // the backend can issue the correct session lifetime for this login.
        body: JSON.stringify({
          email: formData.email.trim().toLowerCase(),
          password: formData.password,
          rememberMe: Boolean(formData.rememberMe),
        }),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }

      if (response.status === 423) {
        setIsLocked(true);
        throw new Error(data.message || "Account is temporarily locked");
      }

      if (!response.ok) {
        throw new Error(data.message || "Login failed");
      }
    
      navigate("/dashboard"); 
    
    } catch (error) {
      setErrorMessage(error.message || "Login failed");
    }
  }

  return (
    <Login
      onSubmit={handleLogin}
      errorMessage={errorMessage}
      isLocked={isLocked}
    />
  );
}
