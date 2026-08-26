import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Login } from './screens/Login';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Screens are added here by Tasks 14-17. */}
        <Route path="/login" element={<Login />} />
        <Route
          path="*"
          element={
            <main className="grid min-h-dvh place-items-center text-[var(--color-muted)]">
              Loading…
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
