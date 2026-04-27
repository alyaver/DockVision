import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Registration from "../pages/Registration";

const API_BASE_URL = "/api/auth"; // updated base URL to match server route changes

const REGISTRATION_MESSAGES = {
  duplicateEmail: "Email already registered",
  invalidRequest:
    "Unable to create account. Please check your information and try again.",
  serviceOffline: "Local service offline",
  fallback: "Registration failed. Please try again.",
};

async function readResponseData(response) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getRegistrationErrorMessage(error) {
  if (error?.name === "TypeError") {
    return REGISTRATION_MESSAGES.serviceOffline;
  }

  if (error?.status === 409) {
    return REGISTRATION_MESSAGES.duplicateEmail;
  }

  if (error?.status === 400) {
    return REGISTRATION_MESSAGES.invalidRequest;
  }

  if (error?.status >= 500) {
    return REGISTRATION_MESSAGES.serviceOffline;
  }

  return error?.serverMessage || REGISTRATION_MESSAGES.fallback;
}

export default function Register() {
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

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

      const data = await readResponseData(response);

      if (!response.ok) {
        const error = new Error(data.message || REGISTRATION_MESSAGES.fallback);
        error.status = response.status;
        error.serverMessage = data.message;
        throw error;
      }

      navigate("/login", { state: { message: "Account created successfully. Please log in." } });
    } catch (error) {
      setErrorMessage(getRegistrationErrorMessage(error));
      throw error;
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
