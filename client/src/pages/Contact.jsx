import Navigation from '../components/Navigation';
import '../Contact.css';
import '../NavBar.css';
import { useState } from "react";

const Contact = () => {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    message: "",
  });

  const [statusMessage, setStatusMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((currentFormData) => ({
      ...currentFormData,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setIsSubmitting(true);
    setStatusMessage("");
    setIsError(false);

    const payload = {
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      email: formData.email.trim().toLowerCase(),
      message: formData.message.trim(),
    };


    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || "Something went wrong. Try again.");
      }

      setStatusMessage(data.message || "Your support request was submitted successfully.");
      setIsError(false);

      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        message: "",
      });
    } catch (error) {
      setStatusMessage(error.message || "Network error. Try again.");
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  };


  return(
    <>
      <Navigation />
        <main className = "contact-page">
          <section className="contact-hero">
            <h1 className="contact-heading">Contact Us
              <p className="contact-description">
                Having trouble with DockVision? Leave a message and we'll
                get back to you shortly.
              </p>
            </h1>

            <form className="info-fields" onSubmit={handleSubmit}>
              <input 
                className="value-box" 
                type="text" 
                id= "firstName"
                name="firstName"
                placeholder="First Name"
                value={formData.firstName}
                onChange={handleChange}
              />
              <input
                className="value-box"
                type="text"
                id="lastName"
                name="lastName"
                placeholder="Last Name"
                value={formData.lastName}
                onChange={handleChange}
              />
              <input 
                className="value-box" 
                type="text" 
                id="email"
                name="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleChange}
              />
              <textarea 
                className="msg-box"  
                id="message"
                name="message"
                placeholder="Message"
                value={formData.message}
                onChange={handleChange}
              />
              <button 
                className="submit-button"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit"}
              </button>
            </form>
          </section>
        </main>
    </>
  );
};

export default Contact;