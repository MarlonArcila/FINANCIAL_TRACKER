import { convertMinorUnits, normalizeCurrencyCodes, type CandidateKind, type RiskTolerance, type TransactionKind } from "@capitalflow/core";

import { invokeFunction } from "./api";
import { cachedUserQuery } from "./cache";
import { demoMode } from "./env";
import { readDemoState, updateDemoState } from "./demoStore";
import { requireSupabase } from "./supabase";
import type {
  Account,
  AdvisorSnapshot,
  Category,
  DashboardSummary,
  FinancialPreferences,
  FxRateResult,
  Goal,
  Investment,
  OnboardingState,
  Profile,
  SourceConnection,
  Subscription,
  Transaction,
  TransactionCandidate,
} from "./types";

export async function loadProfile(userId: string): Promise<Profile> {
  if (demoMode) return readDemoState().profile;
  return cachedUserQuery(`profile:${userId}`, async () => {
    const { data, error } = await requireSupabase().from("profiles").select("*").eq("id", userId).single();
    if (error) throw error;
    return data as Profile;
  }, userId);
}

export async function updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile> {
  if (patch.base_currency || patch.enabled_currencies) {
    const base = (patch.base_currency ?? (await loadProfile(userId)).base_currency).toUpperCase();
    patch = { ...patch, base_currency: base, enabled_currencies: normalizeCurrencyCodes(patch.enabled_currencies ?? (await loadProfile(userId)).enabled_currencies ?? [], base) };
  }
  if (demoMode) {
    return updateDemoState((state) => {
      state.profile = { ...state.profile, ...patch, id: userId };
    }).profile;
  }
  const { data, error } = await requireSupabase()
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function loadSubscription(userId: string): Promise<Subscription | null> {
  if (demoMode) {
    return {
      id: "demo-subscription",
      provider: "whop",
      status: "active",
      interval: "annual",
      current_period_end: "2099-12-31T23:59:59.000Z",
      cancel_at_period_end: false,
    };
  }
  const { data, error } = await requireSupabase()
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as Subscription[];
  const active = rows.filter((item) => (item.status === "active" || item.status === "trialing") && (!item.current_period_end || Date.parse(item.current_period_end) > Date.now()));
  return active.find((item) => item.interval === "annual") ?? active[0] ?? rows[0] ?? null;
}

export async function listAccounts(): Promise<Account[]> {
  if (demoMode) return readDemoState().accounts.filter((item) => !item.is_archived);
  return cachedUserQuery("accounts", async () => {
    const { data, error } = await requireSupabase()
      .from("accounts")
      .select("*")
      .eq("is_archived", false)
      .order("is_primary", { ascending: false })
      .order("created_at");
    if (error) throw error;
    return (data ?? []) as Account[];
  });
}

export async function listAllAccounts(): Promise<Account[]> {
  if (demoMode) return readDemoState().accounts;
  const { data, error } = await requireSupabase().from("accounts").select("*")
    .order("is_archived", { ascending: true }).order("is_primary", { ascending: false }).order("created_at");
  if (error) throw error;
  return (data ?? []) as Account[];
}

export async function createAccount(input: {
  name: string;
  type: Account["type"];
  currency: string;
  opening_balance_minor: number;
  purpose?: Account["purpose"];
  purpose_label?: string | null;
}): Promise<Account> {
  if (demoMode) {
    const current = readDemoState().accounts.filter((item) => !item.is_archived);
    const account: Account = {
      id: crypto.randomUUID(),
      name: input.name, type: input.type, currency: input.currency, opening_balance_minor: input.opening_balance_minor,
      is_archived: false, is_primary: current.length === 0, purpose: current.length === 0 ? "general" : (input.purpose ?? "other"),
      purpose_label: current.length === 0 ? null : input.purpose_label ?? null, archived_at: null,
    };
    updateDemoState((state) => state.accounts.push(account));
    return account;
  }
  const result = await invokeFunction<{ account: Account }>("account-manage", {
    action: "create", name: input.name, type: input.type, currency: input.currency, openingBalanceMinor: input.opening_balance_minor,
    purpose: input.purpose ?? "general", purposeLabel: input.purpose_label ?? null,
  });
  return result.account;
}

export async function setAccountArchived(accountId: string, archived: boolean): Promise<Account> {
  if (demoMode) {
    return updateDemoState((state) => {
      const account = state.accounts.find((item) => item.id === accountId);
      if (!account) throw new Error("No se encontró la cuenta.");
      if (account.is_primary) throw new Error("La cuenta principal no puede archivarse.");
      account.is_archived = archived;
      account.archived_at = archived ? new Date().toISOString() : null;
    }).accounts.find((item) => item.id === accountId)!;
  }
  const result = await invokeFunction<{ account: Account }>("account-manage", { action: archived ? "archive" : "restore", accountId });
  return result.account;
}

export async function loadOnboardingState(userId: string): Promise<OnboardingState> {
  if (demoMode) return { ...readDemoState().onboardingState, user_id: userId };
  const client = requireSupabase();
  const { data, error } = await client.from("onboarding_state").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (data) return data as OnboardingState;
  const { data: created, error: createError } = await client.from("onboarding_state").insert({ user_id: userId }).select("*").single();
  if (createError) throw createError;
  return created as OnboardingState;
}

export async function updateOnboardingState(userId: string, patch: Partial<OnboardingState>): Promise<OnboardingState> {
  if (demoMode) {
    return updateDemoState((demo) => { demo.onboardingState = { ...demo.onboardingState, ...patch, user_id: userId }; if (patch.completed_at) demo.profile.onboarding_completed = true; }).onboardingState;
  }
  const { data, error } = await requireSupabase().from("onboarding_state").update(patch).eq("user_id", userId).select("*").single();
  if (error) throw error;
  return data as OnboardingState;
}

export async function completeOnboarding(userId: string): Promise<void> {
  const completedAt = new Date().toISOString();
  if (demoMode) { updateDemoState((state) => { state.profile.onboarding_completed = true; state.onboardingState.completed_at = completedAt; }); return; }
  const client = requireSupabase();
  const { error: profileError } = await client.from("profiles").update({ onboarding_completed: true }).eq("id", userId);
  if (profileError) throw profileError;
  const { error } = await client.from("onboarding_state").update({ completed_at: completedAt }).eq("user_id", userId);
  if (error) throw error;
}

export async function listCategories(): Promise<Category[]> {
  if (demoMode) return readDemoState().categories;
  return cachedUserQuery("categories", async () => {
    const { data, error } = await requireSupabase().from("categories").select("*").order("name");
    if (error) throw error;
    return (data ?? []) as Category[];
  });
}

export async function createCategory(input: {
  name: string;
  kind: Category["kind"];
  icon?: string | null;
}): Promise<Category> {
  if (demoMode) {
    const category: Category = {
      id: crypto.randomUUID(),
      name: input.name,
      kind: input.kind,
      icon: input.icon ?? null,
      color: null,
      is_system: false,
    };
    updateDemoState((state) => state.categories.push(category));
    return category;
  }
  const { data, error } = await requireSupabase().from("categories").insert(input).select("*").single();
  if (error) throw error;
  return data as Category;
}

export async function listTransactions(limit = 100, accountId: string | null = null): Promise<Transaction[]> {
  if (demoMode) {
    return readDemoState().transactions
      .filter((item) => !accountId || item.account_id === accountId)
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, limit);
  }
  return cachedUserQuery(`transactions:${limit}:${accountId ?? "all"}`, async () => {
    let query = requireSupabase()
      .from("transactions")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (accountId) query = query.eq("account_id", accountId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Transaction[];
  });
}

export async function createTransaction(input: {
  account_id: string;
  category_id: string | null;
  kind: TransactionKind;
  amount_minor: number;
  currency: string;
  merchant: string | null;
  description: string | null;
  occurred_at: string;
}): Promise<Transaction> {
  if (demoMode) {
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      ...input,
      source: "manual",
      created_at: new Date().toISOString(),
    };
    updateDemoState((state) => state.transactions.push(transaction));
    return transaction;
  }
  const { data, error } = await requireSupabase()
    .from("transactions")
    .insert({ ...input, source: "manual" })
    .select("*")
    .single();
  if (error) throw error;
  return data as Transaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  if (demoMode) {
    updateDemoState((state) => {
      state.transactions = state.transactions.filter((transaction) => transaction.id !== id);
    });
    return;
  }
  const { error } = await requireSupabase().from("transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function listPendingCandidates(): Promise<TransactionCandidate[]> {
  if (demoMode) return readDemoState().candidates.filter((item) => item.status === "pending");
  return cachedUserQuery("candidates:pending", async () => {
    const { data, error } = await requireSupabase()
      .from("transaction_candidates")
      .select("*")
      .eq("status", "pending")
      .order("occurred_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as TransactionCandidate[];
  });
}

export async function decideCandidate(input: {
  candidateId: string;
  action: "accept" | "reject";
  accountId?: string;
  categoryId?: string | null;
  rememberSourceAccount?: boolean;
  learnCategory?: boolean;
  corrections?: {
    kind?: CandidateKind;
    amountMinor?: number;
    currency?: string;
    merchant?: string | null;
    description?: string | null;
  };
}): Promise<void> {
  if (demoMode) {
    updateDemoState((state) => {
      const candidate = state.candidates.find((item) => item.id === input.candidateId);
      if (!candidate) return;
      candidate.status = input.action === "accept" ? "accepted" : "rejected";
      if (input.action === "accept") {
        const corrections = input.corrections ?? {};
        state.transactions.push({
          id: crypto.randomUUID(),
          account_id: input.accountId ?? state.accounts[0]?.id ?? "demo-cash",
          category_id: input.categoryId ?? null,
          kind: corrections.kind ?? candidate.proposed_kind,
          amount_minor: corrections.amountMinor ?? candidate.amount_minor,
          currency: corrections.currency ?? candidate.currency,
          merchant: corrections.merchant ?? candidate.merchant,
          description: corrections.description ?? candidate.description,
          occurred_at: candidate.occurred_at,
          source: candidate.provider,
          created_at: new Date().toISOString(),
        });
      }
    });
    return;
  }

  await invokeFunction("transaction-confirm", {
    candidateId: input.candidateId,
    action: input.action,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    categoryId: input.categoryId ?? null,
    rememberSourceAccount: input.rememberSourceAccount ?? true,
    learnCategory: input.learnCategory ?? true,
    corrections: input.corrections ?? {},
  });
}

export async function listGoals(): Promise<Goal[]> {
  if (demoMode) return readDemoState().goals;
  return cachedUserQuery("goals", async () => {
    const { data, error } = await requireSupabase().from("goal_progress").select("*").order("priority", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Goal[];
  });
}

export async function createGoal(input: {
  category_id: string | null;
  name: string;
  target_minor: number;
  currency: string;
  target_date: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
}): Promise<Goal> {
  if (demoMode) {
    const goal: Goal = {
      id: crypto.randomUUID(),
      ...input,
      current_minor: 0,
      status: "active",
    };
    updateDemoState((state) => state.goals.push(goal));
    return goal;
  }
  const { data, error } = await requireSupabase().from("goals").insert(input).select("*").single();
  if (error) throw error;
  return { ...(data as Goal), current_minor: 0 };
}

export async function contributeToGoal(goalId: string, amountMinor: number, note: string | null): Promise<void> {
  if (demoMode) {
    updateDemoState((state) => {
      const goal = state.goals.find((item) => item.id === goalId);
      if (!goal) return;
      goal.current_minor = Math.min(goal.target_minor, goal.current_minor + amountMinor);
      if (goal.current_minor >= goal.target_minor) goal.status = "completed";
    });
    return;
  }
  const { error } = await requireSupabase().from("goal_contributions").insert({
    goal_id: goalId,
    amount_minor: amountMinor,
    note,
    contributed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function listInvestments(): Promise<Investment[]> {
  if (demoMode) return readDemoState().investments;
  return cachedUserQuery("investments", async () => {
    const { data, error } = await requireSupabase().from("investment_performance").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Investment[];
  });
}

export async function createInvestment(input: {
  category_id: string | null;
  name: string;
  asset_class: string;
  currency: string;
  net_contributions_minor: number;
  current_value_minor: number;
  risk_level: RiskTolerance;
  notes: string | null;
}): Promise<Investment> {
  const returnBps = input.net_contributions_minor === 0
    ? null
    : Math.round(((input.current_value_minor - input.net_contributions_minor) / input.net_contributions_minor) * 10_000);
  if (demoMode) {
    const investment: Investment = {
      id: crypto.randomUUID(),
      ...input,
      return_bps: returnBps,
      updated_at: new Date().toISOString(),
    };
    updateDemoState((state) => state.investments.push(investment));
    return investment;
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from("investments")
    .insert({
      category_id: input.category_id,
      name: input.name,
      asset_class: input.asset_class,
      currency: input.currency,
      risk_level: input.risk_level,
      notes: input.notes,
    })
    .select("*")
    .single();
  if (error) throw error;

  const id = (data as { id: string }).id;
  if (input.net_contributions_minor > 0) {
    const { error: contributionError } = await client.from("investment_transactions").insert({
      investment_id: id,
      kind: "contribution",
      amount_minor: input.net_contributions_minor,
      occurred_at: new Date().toISOString(),
    });
    if (contributionError) throw contributionError;
  }
  const { error: valuationError } = await client.from("investment_valuations").insert({
    investment_id: id,
    value_minor: input.current_value_minor,
    valued_at: new Date().toISOString(),
  });
  if (valuationError) throw valuationError;
  return {
    id,
    ...input,
    return_bps: returnBps,
    updated_at: new Date().toISOString(),
  };
}

export type InvestmentActivityKind = "contribution" | "withdrawal" | "income" | "fee";

export async function recordInvestmentActivity(input: {
  investment_id: string;
  kind: InvestmentActivityKind;
  amount_minor: number;
  occurred_at: string;
  note: string | null;
}): Promise<void> {
  if (!Number.isSafeInteger(input.amount_minor) || input.amount_minor < 0) {
    throw new Error("El monto de la inversión debe ser un entero seguro no negativo.");
  }

  if (demoMode) {
    updateDemoState((state) => {
      const investment = state.investments.find((item) => item.id === input.investment_id);
      if (!investment) throw new Error("No se encontró la inversión.");
      if (input.kind === "contribution") {
        investment.net_contributions_minor += input.amount_minor;
      } else if (input.kind === "withdrawal") {
        investment.net_contributions_minor = Math.max(0, investment.net_contributions_minor - input.amount_minor);
      }
      investment.return_bps = investment.net_contributions_minor === 0
        ? null
        : Math.round(((investment.current_value_minor - investment.net_contributions_minor) / investment.net_contributions_minor) * 10_000);
      investment.updated_at = input.occurred_at;
    });
    return;
  }

  const { error } = await requireSupabase().from("investment_transactions").insert(input);
  if (error) throw error;
}

export async function recordInvestmentValuation(input: {
  investment_id: string;
  value_minor: number;
  valued_at: string;
  note: string | null;
}): Promise<void> {
  if (!Number.isSafeInteger(input.value_minor) || input.value_minor < 0) {
    throw new Error("El valor de la inversión debe ser un entero seguro no negativo.");
  }

  if (demoMode) {
    updateDemoState((state) => {
      const investment = state.investments.find((item) => item.id === input.investment_id);
      if (!investment) throw new Error("No se encontró la inversión.");
      investment.current_value_minor = input.value_minor;
      investment.return_bps = investment.net_contributions_minor === 0
        ? null
        : Math.round(((investment.current_value_minor - investment.net_contributions_minor) / investment.net_contributions_minor) * 10_000);
      investment.updated_at = input.valued_at;
    });
    return;
  }

  const { error } = await requireSupabase().from("investment_valuations").insert(input);
  if (error) throw error;
}

export async function listConnections(): Promise<SourceConnection[]> {
  if (demoMode) return [];
  return cachedUserQuery("source-connections", async () => {
    const { data, error } = await requireSupabase().from("source_connections").select("*").order("created_at");
    if (error) throw error;
    return (data ?? []) as SourceConnection[];
  });
}

export async function loadFinancialPreferences(): Promise<FinancialPreferences> {
  if (demoMode) return readDemoState().financialPreferences;
  const { data, error } = await requireSupabase().from("financial_preferences").select("*").single();
  if (error) throw error;
  return data as FinancialPreferences;
}

export async function updateFinancialPreferences(patch: Partial<FinancialPreferences>): Promise<FinancialPreferences> {
  if (demoMode) {
    return updateDemoState((state) => { state.financialPreferences = { ...state.financialPreferences, ...patch }; }).financialPreferences;
  }
  const { data, error } = await requireSupabase().from("financial_preferences").update(patch).select("*").single();
  if (error) throw error;
  return data as FinancialPreferences;
}


export async function loadAdvisorSnapshot(userId: string, currency: string): Promise<AdvisorSnapshot> {
  const normalizedCurrency = currency.toUpperCase();
  const [accounts, transactions, categories, preferences] = await Promise.all([
    listAccounts(),
    listTransactions(2000),
    listCategories(),
    loadFinancialPreferences(),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const relevantAccounts = accounts.filter((account) => account.currency === normalizedCurrency && !account.is_archived);
  const liquidAccountIds = new Set(relevantAccounts.filter((account) => ["cash", "checking", "savings"].includes(account.type)).map((account) => account.id));
  const savingsAccountIds = new Set(relevantAccounts.filter((account) => account.type === "savings").map((account) => account.id));

  const balances = new Map(relevantAccounts.map((account) => [account.id, account.opening_balance_minor]));
  const now = Date.now();
  const cutoff = now - 90 * 86_400_000;
  let firstRecentAt = now;
  let recentIncome = 0;
  let recentEssentialExpense = 0;
  let recentDiscretionaryExpense = 0;

  for (const transaction of transactions) {
    if (transaction.currency !== normalizedCurrency) continue;
    if (balances.has(transaction.account_id)) {
      const delta = transactionBalanceDelta(transaction);
      balances.set(transaction.account_id, (balances.get(transaction.account_id) ?? 0) + delta);
    }
    const occurred = Date.parse(transaction.occurred_at);
    if (!Number.isFinite(occurred) || occurred < cutoff || occurred > now) continue;
    firstRecentAt = Math.min(firstRecentAt, occurred);
    if (transaction.kind === "income" || transaction.kind === "investment_return") {
      recentIncome += transaction.amount_minor;
      continue;
    }
    if (transaction.kind !== "expense") continue;
    const category = transaction.category_id ? categoryById.get(transaction.category_id) : null;
    if (category && isEssentialCategoryName(category.name)) recentEssentialExpense += transaction.amount_minor;
    else recentDiscretionaryExpense += transaction.amount_minor;
  }

  const observedDays = firstRecentAt === now ? 30 : Math.max(30, Math.min(90, Math.ceil((now - firstRecentAt) / 86_400_000)));
  const monthlyFactor = 30.4375 / observedDays;
  const liquidBalanceMinor = Math.max(0, [...liquidAccountIds].reduce((sum, id) => sum + (balances.get(id) ?? 0), 0));
  const estimatedEmergencyFundMinor = Math.max(0, [...savingsAccountIds].reduce((sum, id) => sum + (balances.get(id) ?? 0), 0));

  return {
    currency: normalizedCurrency,
    liquidBalanceMinor,
    averageMonthlyIncomeMinor: Math.round(recentIncome * monthlyFactor),
    averageMonthlyEssentialExpenseMinor: Math.round(recentEssentialExpense * monthlyFactor),
    averageMonthlyDiscretionaryExpenseMinor: Math.round(recentDiscretionaryExpense * monthlyFactor),
    estimatedEmergencyFundMinor,
    historyDays: observedDays,
    riskTolerance: preferences.risk_tolerance,
    emergencyMonthsTarget: Number(preferences.emergency_months_target),
    targetAnnualReturnBps: Number(preferences.target_annual_return_bps),
    horizonMonths: Number(preferences.horizon_months),
    assumptions: [
      `Promedios calculados con hasta ${observedDays} días de movimientos confirmados en ${normalizedCurrency}.`,
      "Liquidez estimada con cuentas de efectivo, corriente y ahorro; tarjetas de crédito e inversiones se excluyen.",
      "La reserva de emergencia se aproxima con saldos positivos de cuentas de ahorro.",
      "Los gastos esenciales se infieren por categorías de vivienda, alimentación, transporte, salud y educación; el usuario puede corregir cualquier cifra.",
    ],
  };
}

function transactionBalanceDelta(transaction: Transaction): number {
  if (transaction.kind === "income" || transaction.kind === "investment_return") return transaction.amount_minor;
  if (["expense", "goal_contribution", "investment_contribution"].includes(transaction.kind)) return -transaction.amount_minor;
  return 0;
}

function isEssentialCategoryName(name: string): boolean {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase();
  return /vivienda|arriendo|alquiler|hipoteca|aliment|mercado|supermerc|transporte|salud|medic|educa|coleg|univers/u.test(normalized);
}

export async function getFxRate(base: string, quote: string, amountMinor?: number): Promise<FxRateResult> {
  const normalizedBase = base.toUpperCase();
  const normalizedQuote = quote.toUpperCase();
  if (demoMode) {
    const rate = demoRate(normalizedBase, normalizedQuote);
    return {
      base: normalizedBase, quote: normalizedQuote, rate,
      convertedMinor: amountMinor === undefined ? null : convertMinorUnits(amountMinor, normalizedBase, normalizedQuote, rate),
      provider: "demo_google_finance_reference",
      sourceLabel: "Google Finance (simulado en demo)",
      fetchedAt: new Date().toISOString(),
      warning: "Modo demo: la tasa es simulada. En producción se muestra la fuente y fecha de la referencia de Google Finance.",
      cached: true,
    };
  }
  return invokeFunction<FxRateResult>("fx-rate", { base: normalizedBase, quote: normalizedQuote, ...(amountMinor === undefined ? {} : { amountMinor }) });
}

export async function loadDashboardSummary(accountId: string | null = null): Promise<DashboardSummary> {
  const [transactions, candidates, profile, accounts] = await Promise.all([
    listTransactions(500, accountId),
    listPendingCandidates(),
    demoMode ? Promise.resolve(readDemoState().profile) : requireCurrentProfile(),
    listAccounts(),
  ]);
  const scopedAccount = accountId ? accounts.find((account) => account.id === accountId) ?? null : null;
  const baseCurrency = scopedAccount?.currency ?? profile.base_currency;
  const totals = new Map<string, { income: number; expense: number }>();
  for (const transaction of transactions) {
    if (transaction.kind !== "income" && transaction.kind !== "expense") continue;
    const current = totals.get(transaction.currency) ?? { income: 0, expense: 0 };
    if (transaction.kind === "income") current.income += transaction.amount_minor;
    else current.expense += transaction.amount_minor;
    totals.set(transaction.currency, current);
  }

  let incomeMinor = 0;
  let expenseMinor = 0;
  let fxWarning: string | null = null;
  let fxAsOf: string | null = null;
  const convertedCurrencies: string[] = [];
  for (const [currency, values] of totals) {
    if (currency === baseCurrency) {
      incomeMinor += values.income;
      expenseMinor += values.expense;
      continue;
    }
    try {
      const result = await getFxRate(currency, baseCurrency);
      incomeMinor += convertMinorUnits(values.income, currency, baseCurrency, result.rate);
      expenseMinor += convertMinorUnits(values.expense, currency, baseCurrency, result.rate);
      convertedCurrencies.push(currency);
      fxWarning = result.warning;
      if (!fxAsOf || Date.parse(result.fetchedAt) > Date.parse(fxAsOf)) fxAsOf = result.fetchedAt;
    } catch {
      fxWarning = `No fue posible convertir ${currency} a ${baseCurrency}; esos movimientos no se incluyen temporalmente en el total consolidado.`;
    }
  }


  return {
    incomeMinor,
    expenseMinor,
    balanceMinor: incomeMinor - expenseMinor,
    pendingCandidates: candidates.length,
    baseCurrency,
    convertedCurrencies,
    fxWarning,
    fxAsOf,
  };
}

function demoRate(base: string, quote: string): number {
  if (base === quote) return 1;
  const copPerUnit: Record<string, number> = { COP: 1, USD: 4000, EUR: 4300, GBP: 5000, MXN: 235, BRL: 760, CAD: 2900 };
  const baseCop = copPerUnit[base];
  const quoteCop = copPerUnit[quote];
  if (!baseCop || !quoteCop) return 1;
  return baseCop / quoteCop;
}

async function requireCurrentProfile(): Promise<Profile> {
  const client = requireSupabase();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error("Sesión requerida.");
  return loadProfile(data.user.id);
}

export async function listDataImports(): Promise<import("./types").DataImportRecord[]> {
  if (demoMode) return [];
  const { data, error } = await requireSupabase().from("data_imports").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as import("./types").DataImportRecord[];
}

export async function importTransactionRows(input: {
  importId?: string;
  filename?: string;
  fileType?: "csv" | "tsv" | "txt" | "xlsx" | "xls" | "json";
  fileSha256?: string;
  sourceApp?: string | null;
  mapping?: Record<string, string>;
  defaultAccountId: string;
  createMissingCategories?: boolean;
  rows: Array<{
    source_row: number;
    occurred_at: string;
    kind: "income" | "expense";
    amount_minor: number;
    currency: string;
    merchant: string | null;
    description: string | null;
    category_name: string | null;
    account_name: string | null;
  }>;
  finalChunk?: boolean;
}): Promise<{
  importId: string;
  imported: number;
  duplicates: number;
  rejected: number;
  errors: Array<{ sourceRow: number; reason: string }>;
  cumulative: { rows_seen: number; rows_imported: number; rows_duplicate: number; rows_rejected: number };
  completed: boolean;
}> {
  if (demoMode) {
    for (const row of input.rows) {
      const transaction: Transaction = {
        id: crypto.randomUUID(),
        account_id: input.defaultAccountId,
        category_id: null,
        kind: row.kind,
        amount_minor: row.amount_minor,
        currency: row.currency,
        merchant: row.merchant,
        description: row.description,
        occurred_at: row.occurred_at,
        source: "import_file",
        created_at: new Date().toISOString(),
      };
      updateDemoState((state) => state.transactions.push(transaction));
    }
    return {
      importId: input.importId ?? crypto.randomUUID(), imported: input.rows.length, duplicates: 0, rejected: 0, errors: [],
      cumulative: { rows_seen: input.rows.length, rows_imported: input.rows.length, rows_duplicate: 0, rows_rejected: 0 }, completed: Boolean(input.finalChunk),
    };
  }
  return await invokeFunction("import-transactions", input);
}

export async function listStorageConnections(): Promise<import("./types").StorageConnection[]> {
  if (demoMode) return [{ id: "demo-drive", provider: "google_drive", account_label: "demo@example.com", status: "active", last_backup_at: null, last_restore_at: null, last_error: null, backup_frequency: "weekly", next_backup_at: null }];
  const { data, error } = await requireSupabase().from("storage_connections").select("*").order("created_at");
  if (error) throw error;
  return (data ?? []) as import("./types").StorageConnection[];
}

export async function listCloudBackups(): Promise<import("./types").CloudBackup[]> {
  if (demoMode) return [];
  const { data, error } = await requireSupabase().from("cloud_backups").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as import("./types").CloudBackup[];
}
