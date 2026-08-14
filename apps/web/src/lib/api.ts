import { env } from "./env";
import { requireSupabase } from "./supabase";

export async function invokeFunction<TResponse>(
  functionName: string,
  body?: unknown,
): Promise<TResponse> {
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sesión requerida.");

  if (!env.functionsBaseUrl) {
    const { data, error } = await client.functions.invoke<TResponse>(functionName, { body });
    if (error) throw error;
    return data;
  }

  const response = await fetch(`${env.functionsBaseUrl.replace(/\/$/u, "")}/${functionName}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Function ${functionName} failed with ${response.status}.`);
  }
  return (await response.json()) as TResponse;
}
