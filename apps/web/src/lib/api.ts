import { env } from "./env";
import { requireSupabase } from "./supabase";

type FunctionBody = Record<string, unknown>;

export async function invokeFunction<TResponse>(
  functionName: string,
  body?: FunctionBody,
): Promise<TResponse> {
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sesión requerida.");

  if (!env.functionsBaseUrl) {
    client.functions.setAuth(accessToken);

    const options =
      body === undefined
        ? {}
        : { body };

    const { data, error } =
      await client.functions.invoke<TResponse>(
        functionName,
        options,
      );

    if (error) throw error;

    if (data === null) {
      throw new Error(
        `Function ${functionName} returned no data.`,
      );
    }

    return data;
  }

  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  };
  if (body !== undefined) requestInit.body = JSON.stringify(body);

  const response = await fetch(
    `${env.functionsBaseUrl.replace(/\/$/u, "")}/${functionName}`,
    requestInit,
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Function ${functionName} failed with ${response.status}.`);
  }
  return (await response.json()) as TResponse;
}
