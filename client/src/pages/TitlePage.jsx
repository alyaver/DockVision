import Navigation from '../components/Navigation';
import '../Title.css';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const TitlePage = () => {

  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/Dashboard');
    }, 3000); // 3 seconds

    return () => clearTimeout(timer); // cleanup
  }, 
  []
  );

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