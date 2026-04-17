import React, { useState } from "react";
import Registration from "../pages/Registration";

const API_BASE_URL = "http://localhost:3001/api";

export default function Register() {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister(formData) {
    try {
      setErrorMessage("");
      setIsSubmitting(true);

      const response = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.message || "Registration failed");
      }

      window.location.href = "/dashboard";
    } catch (error) {
      setErrorMessage(error.message || "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Registration
      onSubmit={handleRegister}
      errorMessage={errorMessage}
      isSubmitting={isSubmitting}
    />
  );
}