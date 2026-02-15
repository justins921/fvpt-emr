import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PatientsPage from './pages/PatientsPage';
import PatientChartPage from './pages/PatientChartPage';
import SchedulePage from './pages/SchedulePage';
import BillingPage from './pages/BillingPage';
import AdminPage from './pages/AdminPage';
import SupportPage from './pages/SupportPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  const { checkAuth, isAuthenticated } = useAuth();
  useIdleTimeout();
  useKeyboardShortcuts();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:id/*" element={<PatientChartPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="billing/*" element={<BillingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="admin/*" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
