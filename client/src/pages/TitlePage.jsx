import Navigation from '../components/Navigation';
import '../Title.css';

const TitlePage = () => {
  return (
    <>
      <Navigation />
      <main className="title-page">
        <div className="title-page-box">
          <h1 className="title-page-heading">DockVision</h1>
        </div>
      </main>
    </>
  );
};

export default TitlePage;