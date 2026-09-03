const isDevelopment = import.meta.env.DEV;

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined,
  functionsBaseUrl: import.meta.env.VITE_FUNCTIONS_BASE_URL as string | undefined,
  devBypassSubscription: isDevelopment && import.meta.env.VITE_DEV_BYPASS_SUBSCRIPTION === "true",
  devBypassOnboarding: isDevelopment && import.meta.env.VITE_DEV_BYPASS_ONBOARDING === "true",
  appUrl: (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin,
  weeklyPriceLabel: import.meta.env.VITE_WEEKLY_PRICE_LABEL as string | undefined,
  annualPriceLabel: import.meta.env.VITE_ANNUAL_PRICE_LABEL as string | undefined,
  annualSavingsLabel: import.meta.env.VITE_ANNUAL_SAVINGS_LABEL as string | undefined,
  androidPlayUrl: import.meta.env.VITE_ANDROID_PLAY_URL as string | undefined,
  androidApkUrl: import.meta.env.VITE_ANDROID_APK_URL as string | undefined,
};

export const hasSupabaseConfig = Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const demoMode = env.devBypassSubscription && !hasSupabaseConfig;
