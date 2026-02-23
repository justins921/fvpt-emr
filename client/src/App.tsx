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
import MessagingPage from './pages/MessagingPage';

// New feature pages
import HEPPage from './pages/HEPPage';
import OutcomeMeasuresPage from './pages/OutcomeMeasuresPage';
import IntakeFormsPage from './pages/IntakeFormsPage';
import WaitlistPage from './pages/WaitlistPage';
import TasksPage from './pages/TasksPage';
import RecallPage from './pages/RecallPage';
import ReportingPage from './pages/ReportingPage';
import TelehealthPage from './pages/TelehealthPage';
import FaxPage from './pages/FaxPage';
import EligibilityPage from './pages/EligibilityPage';
import PortalPage from './pages/PortalPage';
import WorkersCompPage from './pages/WorkersCompPage';
import MIPSPage from './pages/MIPSPage';
import FHIRPage from './pages/FHIRPage';
import LocationsPage from './pages/LocationsPage';
import PaymentsPage from './pages/PaymentsPage';
import AuthorizationsPage from './pages/AuthorizationsPage';
import ReferringProvidersPage from './pages/ReferringProvidersPage';

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
        <Route path="messages" element={<MessagingPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="admin/*" element={<AdminPage />} />

        {/* New feature routes */}
        <Route path="exercises/*" element={<HEPPage />} />
        <Route path="outcome-measures" element={<OutcomeMeasuresPage />} />
        <Route path="intake-forms/*" element={<IntakeFormsPage />} />
        <Route path="waitlist" element={<WaitlistPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="recall/*" element={<RecallPage />} />
        <Route path="reports/*" element={<ReportingPage />} />
        <Route path="telehealth/*" element={<TelehealthPage />} />
        <Route path="fax" element={<FaxPage />} />
        <Route path="eligibility" element={<EligibilityPage />} />
        <Route path="portal/*" element={<PortalPage />} />
        <Route path="workers-comp/*" element={<WorkersCompPage />} />
        <Route path="mips" element={<MIPSPage />} />
        <Route path="fhir" element={<FHIRPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="payments/*" element={<PaymentsPage />} />
        <Route path="authorizations" element={<AuthorizationsPage />} />
        <Route path="referring-providers" element={<ReferringProvidersPage />} />
      </Route>
    </Routes>
  );
}
