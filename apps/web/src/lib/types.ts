import type { CandidateKind, CandidateProvider, RiskTolerance, TransactionKind } from "@capitalflow/core";

export interface AppUser {
  id: string;
  email: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  base_currency: string;
  locale: string;
  timezone: string;
  enabled_currencies: string[];
  onboarding_completed: boolean;
}

export interface Subscription {
  id: string;
  provider: "whop";
  status: "trialing" | "active" | "past_due" | "canceled" | "expired" | "unresolved";
  interval: "weekly" | "annual" | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface Account {
  id: string;
  name: string;
  type: "cash" | "checking" | "savings" | "credit" | "investment" | "other";
  currency: string;
  opening_balance_minor: number;
  is_archived: boolean;
  is_primary: boolean;
  purpose: "general" | "trip" | "work" | "shared" | "project" | "other";
  purpose_label: string | null;
  archived_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense" | "goal" | "investment" | "mixed";
  icon: string | null;
  color: string | null;
  is_system: boolean;
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: string | null;
  kind: TransactionKind;
  amount_minor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  source: "manual" | "android_notification" | "gmail" | "outlook" | "system" | "import_file";
  created_at: string;
}

export interface TransactionCandidate {
  id: string;
  provider: CandidateProvider;
  proposed_kind: CandidateKind;
  amount_minor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
  confidence: number;
  status: "pending" | "accepted" | "rejected" | "duplicate" | "expired";
  reasons: string[];
  app_package: string | null;
  review_reason: string | null;
  resolved_account_id: string | null;
  resolved_category_id: string | null;
  automation_score: number | null;
  auto_decision: boolean;
}

export interface Goal {
  id: string;
  category_id: string | null;
  name: string;
  target_minor: number;
  current_minor: number;
  currency: string;
  target_date: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  status: "active" | "completed" | "paused" | "canceled";
}

export interface Investment {
  id: string;
  category_id: string | null;
  name: string;
  asset_class: string;
  currency: string;
  net_contributions_minor: number;
  current_value_minor: number;
  return_bps: number | null;
  risk_level: RiskTolerance;
  notes: string | null;
  updated_at: string;
}

export interface SourceConnection {
  id: string;
  provider: "gmail" | "outlook";
  email_address: string | null;
  status: "active" | "expired" | "revoked" | "error" | "pending";
  last_sync_at: string | null;
  last_error: string | null;
}

export interface DashboardSummary {
  incomeMinor: number;
  expenseMinor: number;
  balanceMinor: number;
  pendingCandidates: number;
  baseCurrency: string;
  convertedCurrencies: string[];
  fxWarning: string | null;
  fxAsOf: string | null;
}


export interface OnboardingState {
  user_id: string;
  account_completed: boolean;
  currencies_completed: boolean;
  email_completed: boolean;
  notification_completed: boolean;
  calibration_attempted: boolean;
  associations_confirmed: number;
  calibration_target: number;
  completed_at: string | null;
}
export interface FinancialPreferences {
  user_id: string;
  risk_tolerance: RiskTolerance;
  emergency_months_target: number;
  target_annual_return_bps: number;
  horizon_months: number;
  ai_explanations_enabled: boolean;
  auto_post_enabled: boolean;
  auto_post_min_confidence: number;
  auto_review_min_confidence: number;
  learn_from_reviews: boolean;
  auto_use_other_category: boolean;
}

export interface AdvisorSnapshot {
  currency: string;
  liquidBalanceMinor: number;
  averageMonthlyIncomeMinor: number;
  averageMonthlyEssentialExpenseMinor: number;
  averageMonthlyDiscretionaryExpenseMinor: number;
  estimatedEmergencyFundMinor: number;
  historyDays: number;
  riskTolerance: RiskTolerance;
  emergencyMonthsTarget: number;
  targetAnnualReturnBps: number;
  horizonMonths: number;
  assumptions: string[];
}

export interface FxRateResult {
  base: string;
  quote: string;
  rate: number;
  convertedMinor: number | null;
  provider: string;
  sourceLabel: string;
  fetchedAt: string;
  warning: string;
  cached: boolean;
}

export interface DataImportRecord {
  id: string; filename: string; file_type: string; source_app: string | null; status: "processing" | "completed" | "failed" | "canceled";
  rows_seen: number; rows_imported: number; rows_duplicate: number; rows_rejected: number; created_at: string; completed_at: string | null;
}

export interface StorageConnection {
  id: string; provider: "google_drive" | "onedrive"; account_label: string | null; status: "active" | "expired" | "revoked" | "error" | "pending";
  last_backup_at: string | null; last_restore_at: string | null; last_error: string | null; backup_frequency: "manual" | "daily" | "weekly"; next_backup_at: string | null;
}

export interface CloudBackup {
  id: string; provider: "google_drive" | "onedrive"; remote_file_id: string; remote_file_name: string; bytes: number; kind: "manual" | "scheduled" | "pre_restore";
  status: "available" | "restored" | "missing" | "error"; created_at: string; restored_at: string | null;
}
