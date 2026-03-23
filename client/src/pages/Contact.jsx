import Navigation from '../components/Navigation';
import '../Main.css';

const Contact = () => {
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

            <div className="info-fields">
              <input className="value-box" type="text" placeholder="First Name" />
              <input className="value-box" type="text" placeholder="Last Name" />
              <input className="value-box" type="text" placeholder="Email" />
              <input className="msg-box" type="text" placeholder="Message" />
              <button className="submit-button">
                Submit
              </button>
            </div>
          </section>
        </main>
    </>
  );
};

export default Contact;