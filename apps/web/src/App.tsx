import { AppShell } from "./components/AppShell";
import { LoadingScreen } from "./components/LoadingScreen";
import { OnboardingGate } from "./components/OnboardingGate";
import { SubscriptionGate } from "./components/SubscriptionGate";
import { useAndroidCandidateSync } from "./hooks/useAndroidCandidateSync";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
import { AdvisorPage } from "./pages/AdvisorPage";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DataTransferPage } from "./pages/DataTransferPage";
import { GoalsPage } from "./pages/GoalsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { InvestmentsPage } from "./pages/InvestmentsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TransactionsPage } from "./pages/TransactionsPage";

export function App() {
  const session = useSession();
  const [route, navigate] = useHashRoute();
  useAndroidCandidateSync(Boolean(session.user));

  if (session.loading) return <LoadingScreen label="Abriendo CapitalFlow…" />;
  if (!session.user) {
    return <AuthPage onSignIn={session.signIn} onSignUp={session.signUp} onReset={session.resetPassword} />;
  }

  return (
    <SubscriptionGate userId={session.user.id} forcePage={route === "subscription"} onSignOut={session.signOut}>
      <OnboardingGate user={session.user}>
        <AppShell route={route} navigate={navigate} user={session.user} onSignOut={session.signOut}>
          {route === "dashboard" ? <DashboardPage navigate={navigate} /> : null}
          {route === "transactions" ? <TransactionsPage userId={session.user.id} /> : null}
          {route === "goals" ? <GoalsPage userId={session.user.id} /> : null}
          {route === "investments" ? <InvestmentsPage userId={session.user.id} /> : null}
          {route === "advisor" ? <AdvisorPage userId={session.user.id} /> : null}
          {route === "integrations" ? <IntegrationsPage user={session.user} /> : null}
          {route === "data" ? <DataTransferPage user={session.user} /> : null}
          {route === "settings" ? <SettingsPage user={session.user} /> : null}
        </AppShell>
      </OnboardingGate>
    </SubscriptionGate>
  );
}
