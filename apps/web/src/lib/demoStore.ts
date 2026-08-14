import type {
  Account,
  Category,
  Goal,
  Investment,
  Profile,
  FinancialPreferences,
  OnboardingState,
  Transaction,
  TransactionCandidate,
} from "./types";

interface DemoState {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  candidates: TransactionCandidate[];
  goals: Goal[];
  investments: Investment[];
  financialPreferences: FinancialPreferences;
  onboardingState: OnboardingState;
}

const KEY = "capitalflow.demo.v1";

const initialState: DemoState = {
  profile: {
    id: "demo-user",
    full_name: "Usuario demo",
    base_currency: "COP",
    locale: "es-CO",
    timezone: "America/Bogota",
    enabled_currencies: ["COP", "USD"],
    onboarding_completed: false,
  },
  onboardingState: {
    user_id: "demo-user", account_completed: true, currencies_completed: true, email_completed: false, notification_completed: false,
    calibration_attempted: false, associations_confirmed: 0, calibration_target: 3, completed_at: null,
  },
  accounts: [
    {
      id: "demo-cash",
      name: "Cuenta principal",
      type: "checking",
      currency: "COP",
      opening_balance_minor: 1_500_000,
      is_archived: false,
      is_primary: true,
      purpose: "general",
      purpose_label: null,
      archived_at: null,
    },
  ],
  categories: [
    { id: "cat-salary", name: "Salario", kind: "income", icon: "↗", color: null, is_system: true },
    { id: "cat-food", name: "Alimentación", kind: "expense", icon: "◉", color: null, is_system: true },
    { id: "cat-home", name: "Vivienda", kind: "expense", icon: "⌂", color: null, is_system: true },
    { id: "cat-transport", name: "Transporte", kind: "expense", icon: "→", color: null, is_system: true },
    { id: "cat-goal", name: "Reserva", kind: "goal", icon: "◎", color: null, is_system: true },
    { id: "cat-investment", name: "Largo plazo", kind: "investment", icon: "↗", color: null, is_system: true },
    { id: "cat-other", name: "Otros", kind: "mixed", icon: "•", color: null, is_system: true },
  ],
  transactions: [],
  candidates: [
    {
      id: "demo-candidate",
      provider: "android_notification",
      proposed_kind: "expense",
      amount_minor: 45_900,
      currency: "COP",
      merchant: "Mercado Central",
      description: "Compra aprobada — Compra por $45.900 en Mercado Central",
      occurred_at: new Date().toISOString(),
      confidence: 0.91,
      status: "pending",
      reasons: ["Importe detectado", "Palabra clave de gasto"],
      app_package: "com.example.wallet",
      review_reason: "confidence_below_auto_post_threshold",
      resolved_account_id: "demo-cash",
      resolved_category_id: "cat-food",
      automation_score: 0.91,
      auto_decision: false,
    },
  ],
  goals: [
    {
      id: "demo-goal",
      category_id: "cat-goal",
      name: "Fondo de emergencia",
      target_minor: 6_000_000,
      current_minor: 1_200_000,
      currency: "COP",
      target_date: null,
      priority: 5,
      status: "active",
    },
  ],
  investments: [],
  financialPreferences: {
    user_id: "demo-user",
    risk_tolerance: "medium",
    emergency_months_target: 3,
    target_annual_return_bps: 800,
    horizon_months: 60,
    ai_explanations_enabled: true,
    auto_post_enabled: true,
    auto_post_min_confidence: 0.94,
    auto_review_min_confidence: 0.70,
    learn_from_reviews: true,
    auto_use_other_category: true,
  },
};

export function readDemoState(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(initialState);
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    return {
      ...structuredClone(initialState),
      ...parsed,
      profile: { ...structuredClone(initialState.profile), ...(parsed.profile ?? {}) },
      financialPreferences: { ...structuredClone(initialState.financialPreferences), ...(parsed.financialPreferences ?? {}) },
      onboardingState: { ...structuredClone(initialState.onboardingState), ...(parsed.onboardingState ?? {}) },
    };
  } catch {
    return structuredClone(initialState);
  }
}

export function updateDemoState(mutator: (state: DemoState) => void): DemoState {
  const state = readDemoState();
  mutator(state);
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("capitalflow:demo-change"));
  return state;
}

export function resetDemoState(): void {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent("capitalflow:demo-change"));
}
