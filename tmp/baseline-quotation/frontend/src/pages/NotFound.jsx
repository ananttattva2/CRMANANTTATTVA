import React from 'react';
import { ArrowLeft, Home, SearchX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const notFoundGif = '/not-found-planner.gif';

export default function NotFound() {
  const navigate = useNavigate();
  const hasToken = Boolean(localStorage.getItem('token'));
  const homePath = hasToken ? '/dashboard' : '/';

  return (
    <main className="not-found-page">
      <section className="not-found-shell">
        <div className="not-found-copy">
          <span className="not-found-badge"><SearchX className="h-4 w-4" /> 404 Page</span>
          <h1>Page not found</h1>
          <p>This route is not available. You can return to your workspace or go back to the previous page.</p>
          <div className="not-found-actions">
            <button type="button" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button type="button" onClick={() => navigate(homePath)} className="not-found-primary">
              <Home className="h-4 w-4" /> Home
            </button>
          </div>
        </div>
        <div className="not-found-media" aria-label="404 illustration">
          <img src={notFoundGif} alt="Animated planner illustration for 404 page" />
        </div>
      </section>
    </main>
  );
}
