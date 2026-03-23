import Navigation from '../components/Navigation';
import '../About.css';

const TitlePage = () => {
  return (
    <>
      <Navigation />
      <main className="title-page">
        <h1 className="title-page-heading">Atlas</h1>
      </main>
    </>
  );
};

export default TitlePage;