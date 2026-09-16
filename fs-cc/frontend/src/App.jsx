import { Navigate, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.js';

import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Agents from './pages/Agents.jsx';
import Queues from './pages/Queues.jsx';
import LiveCalls from './pages/LiveCalls.jsx';
import QueueStats from './pages/QueueStats.jsx';
import LiveAgents from './pages/LiveAgents.jsx';
import Reports from './pages/Reports.jsx';
import UserManagement from './pages/UserManagement.jsx';
import BreakCodes from './pages/BreakCodes.jsx';
import BreakHistoryReport from './pages/reports/BreakHistoryReport.jsx';
import CallHistoryReport from './pages/reports/CallHistoryReport.jsx';

function ProtectedRoute({ children }) {
  const { isAuth } = useAuth();
  return isAuth ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function ReportsRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  const canView =
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && user.permissions.includes('view_reports'));
  if (!canView) return <Navigate to="/" replace />;
  return children;
}

function BreakCodesRoute({ children }) {
  const { user, isAuth } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  const canManage =
    user?.role === 'admin' ||
    (Array.isArray(user?.permissions) && user.permissions.includes('manage_break_codes'));
  if (!canManage) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="live-calls" element={<LiveCalls />} />
        <Route path="live-agents" element={<LiveAgents />} />
        <Route path="agents" element={<Agents />} />
        <Route path="queues" element={<Queues />} />
        <Route path="queue-stats" element={<QueueStats />} />
        <Route
          path="reports"
          element={
            <ReportsRoute>
              <Reports />
            </ReportsRoute>
          }
        />
        <Route
          path="reports/break-history"
          element={
            <ReportsRoute>
              <BreakHistoryReport />
            </ReportsRoute>
          }
        />
        <Route
          path="reports/call-history"
          element={
            <ReportsRoute>
              <CallHistoryReport />
            </ReportsRoute>
          }
        />
        <Route
          path="break-codes"
          element={
            <BreakCodesRoute>
              <BreakCodes />
            </BreakCodesRoute>
          }
        />
        <Route
          path="users"
          element={
            <AdminRoute>
              <UserManagement />
            </AdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}