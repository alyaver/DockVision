import Navigation from '../components/Navigation';
import '../Main.css';

const About = () => {
  return (
    <>
      <Navigation />
      <main className="about-page">
        <h1 className="about-title">About Atlas</h1>
        <p className="about-description">
          Atlas is a tool designed to help users understand the purpose of the platform.
        </p>
      </main>
    </>
  );
};

export default About;