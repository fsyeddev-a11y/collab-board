import { Routes, Route, Navigate } from 'react-router-dom';
import { useUser, RedirectToSignIn } from '@clerk/clerk-react';
import { DashboardPage } from './pages/DashboardPage';
import { BoardPage } from './pages/BoardPage';

// ── Auth gate ─────────────────────────────────────────────────────────────────
// Renders a loading screen while Clerk initialises, then either lets the
// child render (signed in) or redirects to Clerk's hosted sign-in page.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#f5f5f5',
      }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    // RedirectToSignIn sends the user to Clerk's sign-in page and stores
    // the current path so they are returned here after authentication.
    return <RedirectToSignIn />;
  }

  return <>{children}</>;
}

// ── Router ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      {/* Root → dashboard */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Board list — requires auth */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />

      {/* Canvas — requires auth + board access (enforced by Worker Gate 2) */}
      <Route
        path="/board/:boardId"
        element={
          <ProtectedRoute>
            <BoardPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
