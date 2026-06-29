import { Navigate } from 'react-router-dom';

// Signup is handled by GitHub OAuth — same flow as login (creates account on first use)
export function SignupPage() {
  return <Navigate to="/login" replace />;
}
