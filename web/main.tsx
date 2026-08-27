import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './screens/Login';
import { Onboarding } from './screens/Onboarding';
import { Today } from './screens/Today';
import { GoalsEditor } from './screens/GoalsEditor';
import { RunOver } from './screens/RunOver';
import { Food } from './screens/Food';
import { FoodListEditor } from './screens/FoodListEditor';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/today" element={<Today />} />
        <Route path="/food" element={<Food />} />
        <Route path="/food/:status" element={<FoodListEditor />} />
        <Route path="/me" element={<GoalsEditor />} />
        <Route path="/run-over" element={<RunOver />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
