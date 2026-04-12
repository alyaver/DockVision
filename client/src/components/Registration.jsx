import React, { useState } from "react";
import Registration from "../pages/Register";

export default function Register() {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister(formData) {
    try {
      setErrorMessage("");
      setIsSubmitting(true);

      const response = await fetch("http://localhost:3001/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Registration failed");
      }

      window.location.href = "/Dashboard";
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