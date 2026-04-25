import React, { useState } from "react";
import { useNavigate } from "react-router-dom"; 
import Login from "../pages/Login";

const API_BASE_URL = "/api";

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
        body: JSON.stringify({
          email: formData.email.trim().toLowerCase(),
          password: formData.password,
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
    
      navigate("/about", { state: { fromAuth: true } }); 
    
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