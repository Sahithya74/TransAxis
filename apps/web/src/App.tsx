import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { Guard } from './auth/Guard';
import { AppShell } from './components/layout/AppShell';
import { AccountPage, ForcedPasswordChange } from './features/account/AccountPage';
import { AdminPage } from './features/admin/AdminPage';
import { ADMIN_AREA_PERMISSIONS } from './lib/nav';
import { DashboardPage } from './pages/DashboardPage';
import { BookingDetailPage } from './features/bookings/BookingDetailPage';
import { BookingFormPage } from './features/bookings/BookingFormPage';
import { BookingsPage } from './features/bookings/BookingsPage';
import { CalendarPage } from './features/dispatch/CalendarPage';
import { AssistantPage } from './features/assistant/AssistantPage';
import { DocumentsPage } from './features/documents/DocumentsPage';
import { DriverHome, DriverShell, DriverTripPage } from './features/driver/DriverApp';
import { DriverPayPage } from './features/driver/DriverPay';
import { ExpensesPage } from './features/finance/ExpensesPage';
import { FinanceOverviewPage } from './features/finance/FinanceOverviewPage';
import { InvoiceDetailPage } from './features/finance/InvoiceDetailPage';
import { InvoicesPage } from './features/finance/InvoicesPage';
import { SettlementDetailPage } from './features/finance/SettlementDetailPage';
import { SettlementsPage } from './features/finance/SettlementsPage';
import { FuelPage } from './features/fuel/FuelPage';
import { AlertsPage } from './features/live/AlertsPage';
import { ControlRoomPage } from './features/live/ControlRoomPage';
import { IncidentDetailPage, IncidentsPage } from './features/live/IncidentsPage';
import { LiveMapPage } from './features/live/LiveMapPage';
import { MaintenancePage } from './features/maintenance/MaintenancePage';
import { WorkOrderDetailPage } from './features/maintenance/WorkOrderDetailPage';
import { NotificationsPage } from './features/live/NotificationBell';
import { DispatchBoardPage } from './features/dispatch/DispatchBoardPage';
import { CustomerDetailPage } from './features/parties/CustomerDetailPage';
import { PartiesPage } from './features/parties/PartiesPage';
import { PortalHome, PortalInvoices, PortalRequestPage, PortalShell, PortalShipmentPage, PortalShipments } from './features/portal/PortalApp';
import { InvoicePrint, PayslipPrint } from './features/print/FinancePrints';
import { LorryReceiptPrint, TripSheetPrint } from './features/print/PrintPages';
import { ReportsPage } from './features/reports/ReportsPage';
import { TripDetailPage } from './features/trips/TripDetailPage';
import { TripsPage } from './features/trips/TripsPage';
import { VehicleDetailPage } from './features/vehicles/VehicleDetailPage';
import { VehiclesPage } from './features/vehicles/VehiclesPage';
import { WorkerDetailPage } from './features/workers/WorkerDetailPage';
import { WorkersPage } from './features/workers/WorkersPage';
import { LoginPage } from './pages/LoginPage';
import { StatusPage } from './pages/StatusPage';

/** Signed-in area. `bare` renders pages without the navigation shell (printable documents). */
function RequireAuth({ bare = false }: { bare?: boolean }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        Loading…
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  // A temporary password must be replaced first; the API refuses everything else until then.
  if (user?.mustChangePassword) return <ForcedPasswordChange />;
  return bare ? <Outlet /> : <AppShell />;
}

/** Crew accounts (own trips only) land in the driver app, customers in the portal, everyone else on the dashboard. */
function Home() {
  const { can } = useAuth();
  if (can('trips:update_own') && !can('trips:read')) return <Navigate to="/driver" replace />;
  if (can('portal:access') && !can('bookings:read')) return <Navigate to="/portal" replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth bare />}>
        <Route path="print/lr/:id" element={<Guard anyOf={['bookings:read', 'portal:access']}><LorryReceiptPrint /></Guard>} />
        <Route path="print/invoice/:id" element={<Guard anyOf={['finance:read', 'portal:access']}><InvoicePrint /></Guard>} />
        <Route path="print/payslip/:id" element={<Guard anyOf={['settlements:read', 'settlements:manage', 'settlements:read_own']}><PayslipPrint /></Guard>} />
        <Route path="print/trip/:id" element={<Guard anyOf={['trips:read', 'trips:update_own']}><TripSheetPrint /></Guard>} />
      </Route>
      <Route element={<RequireAuth bare />}>
        <Route path="driver" element={<Guard anyOf={['trips:update_own']}><DriverShell /></Guard>}>
          <Route index element={<DriverHome />} />
          <Route path="trips/:id" element={<DriverTripPage />} />
          <Route path="pay" element={<DriverPayPage />} />
        </Route>
      </Route>
      <Route element={<RequireAuth bare />}>
        <Route path="portal" element={<Guard anyOf={['portal:access']}><PortalShell /></Guard>}>
          <Route index element={<PortalHome />} />
          <Route path="shipments" element={<PortalShipments />} />
          <Route path="shipments/:id" element={<PortalShipmentPage />} />
          <Route path="invoices" element={<PortalInvoices />} />
          <Route path="request" element={<PortalRequestPage />} />
        </Route>
      </Route>
      <Route element={<RequireAuth />}>
        <Route index element={<Home />} />
        <Route path="tracking" element={<Guard anyOf={['tracking:read']}><LiveMapPage /></Guard>} />
        <Route path="control-room" element={<Guard anyOf={['alerts:read']}><ControlRoomPage /></Guard>} />
        <Route path="alerts" element={<Guard anyOf={['alerts:read']}><AlertsPage /></Guard>} />
        <Route path="incidents" element={<Guard anyOf={['incidents:read']}><IncidentsPage /></Guard>} />
        <Route path="incidents/:id" element={<Guard anyOf={['incidents:read']}><IncidentDetailPage /></Guard>} />
        <Route path="notifications" element={<Guard anyOf={['notifications:read']}><NotificationsPage /></Guard>} />
        <Route path="status" element={<StatusPage />} />
        <Route path="dispatch" element={<Guard anyOf={['trips:read']}><DispatchBoardPage /></Guard>} />
        <Route path="calendar" element={<Guard anyOf={['trips:read']}><CalendarPage /></Guard>} />
        <Route path="bookings" element={<Guard anyOf={['bookings:read']}><BookingsPage /></Guard>} />
        <Route path="bookings/new" element={<Guard anyOf={['bookings:write']}><BookingFormPage /></Guard>} />
        <Route path="bookings/:id" element={<Guard anyOf={['bookings:read']}><BookingDetailPage /></Guard>} />
        <Route path="bookings/:id/edit" element={<Guard anyOf={['bookings:write']}><BookingFormPage /></Guard>} />
        <Route path="trips" element={<Guard anyOf={['trips:read']}><TripsPage /></Guard>} />
        <Route path="trips/:id" element={<Guard anyOf={['trips:read', 'trips:update_own']}><TripDetailPage /></Guard>} />
        <Route path="vehicles" element={<Guard anyOf={['vehicles:read']}><VehiclesPage /></Guard>} />
        <Route path="vehicles/:id" element={<Guard anyOf={['vehicles:read']}><VehicleDetailPage /></Guard>} />
        <Route path="workers" element={<Guard anyOf={['workers:read']}><WorkersPage /></Guard>} />
        <Route path="workers/:id" element={<Guard anyOf={['workers:read']}><WorkerDetailPage /></Guard>} />
        <Route path="parties" element={<Guard anyOf={['customers:read', 'vendors:read']}><PartiesPage /></Guard>} />
        <Route path="parties/customers/:id" element={<Guard anyOf={['customers:read']}><CustomerDetailPage /></Guard>} />
        <Route path="maintenance" element={<Guard anyOf={['maintenance:read']}><MaintenancePage /></Guard>} />
        <Route path="maintenance/work-orders/:id" element={<Guard anyOf={['maintenance:read']}><WorkOrderDetailPage /></Guard>} />
        <Route path="fuel" element={<Guard anyOf={['fuel:read', 'finance:read']}><FuelPage /></Guard>} />
        <Route path="finance" element={<Guard anyOf={['finance:read']}><FinanceOverviewPage /></Guard>} />
        <Route path="invoices" element={<Guard anyOf={['finance:read']}><InvoicesPage /></Guard>} />
        <Route path="invoices/:id" element={<Guard anyOf={['finance:read']}><InvoiceDetailPage /></Guard>} />
        <Route path="expenses" element={<Guard anyOf={['finance:read', 'finance:post', 'expenses:submit']}><ExpensesPage /></Guard>} />
        <Route path="settlements" element={<Guard anyOf={['settlements:read', 'settlements:manage']}><SettlementsPage /></Guard>} />
        <Route path="settlements/:id" element={<Guard anyOf={['settlements:read', 'settlements:manage']}><SettlementDetailPage /></Guard>} />
        <Route path="reports" element={<Guard anyOf={['reports:read']}><ReportsPage /></Guard>} />
        <Route path="documents" element={<Guard anyOf={['documents:read']}><DocumentsPage /></Guard>} />
        <Route path="assistant" element={<Guard anyOf={['ai:query']}><AssistantPage /></Guard>} />
        <Route path="admin" element={<Guard anyOf={ADMIN_AREA_PERMISSIONS}><AdminPage /></Guard>} />
        <Route path="account" element={<AccountPage />} />
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
