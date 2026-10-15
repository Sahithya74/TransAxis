import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { Guard } from './auth/Guard';
import { AppShell } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { VehicleDetailPage } from './features/vehicles/VehicleDetailPage';
import { VehiclesPage } from './features/vehicles/VehiclesPage';
import { LoginPage } from './pages/LoginPage';
import { StatusPage } from './pages/StatusPage';

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        Loading…
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <AppShell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<DashboardPage />} />
        <Route path="status" element={<StatusPage />} />
        <Route path="vehicles" element={<Guard anyOf={['vehicles:read']}><VehiclesPage /></Guard>} />
        <Route path="vehicles/:id" element={<Guard anyOf={['vehicles:read']}><VehicleDetailPage /></Guard>} />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-md pt-16 text-center">
              <h1 className="text-2xl">Page not found</h1>
              <p className="mt-2 text-muted">That page doesn’t exist or isn’t available yet.</p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
