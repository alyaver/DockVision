import React, { useState } from "react";
import Registration from "./Registration.jsx";

/**
 * Registration page controller.
 *
 * Decisions:
 * - Keep this file as the controller/wrapper for registration submission.
 * - Render the Registration UI component from Registration.jsx.
 * - Use relative /api calls so Vite proxies to the Express backend on port 5000.
 * - Do not hardcode localhost:3001.
 */
const API_BASE_URL = "/api";

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