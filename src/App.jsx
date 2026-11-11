import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { LoaderScreen, ToastProvider } from './components/ui.jsx';
import { SessionProvider, useSession } from './session.jsx';
import Admin from './pages/Admin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Profile from './pages/Profile.jsx';
import Register from './pages/Register.jsx';
import ToolPage from './pages/ToolPage.jsx';
import WhatsAppSupport from './components/WhatsAppSupport.jsx';

function Protected({ children, staffOnly = false }) {
  const { loading, user, entitlements } = useSession();
  const location = useLocation();

  if (loading) return <LoaderScreen label="جارٍ التحقق من الجلسة…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (staffOnly && !entitlements?.isStaff) return <Navigate to="/app" replace />;
  return <Layout>{children}</Layout>;
}

function GuestOnly({ children }) {
  const { loading, user } = useSession();
  if (loading) return <LoaderScreen label="جارٍ التحميل…" />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <WhatsAppSupport />
        <ScrollReset />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <Login />
              </GuestOnly>
            }
          />
          <Route
            path="/register"
            element={
              <GuestOnly>
                <Register />
              </GuestOnly>
            }
          />
          <Route
            path="/app"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="/app/tools/:toolId"
            element={
              <Protected>
                <ToolPage />
              </Protected>
            }
          />
          <Route
            path="/app/history"
            element={
              <Protected>
                <History />
              </Protected>
            }
          />
          <Route
            path="/app/profile"
            element={
              <Protected>
                <Profile />
              </Protected>
            }
          />
          <Route
            path="/app/admin"
            element={
              <Protected staffOnly>
                <Admin />
              </Protected>
            }
          />
          {/* Canonical short links: /dashboard and /admin are what people type. */}
          <Route path="/dashboard" element={<Navigate to="/app" replace />} />
          <Route path="/admin" element={<Navigate to="/app/admin" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </SessionProvider>
  );
}
