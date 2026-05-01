export type PromptPolicyState = {
  apiBase: string;
  deviceId?: string | null;
  entityId?: number | null;
  botSecret?: string | null;
  channel?: string;
};

type PromptPolicyResponse = {
  success?: boolean;
  policy?: {
    compiledPrompt?: string;
  };
};

export async function fetchCompiledPromptPolicy(state: PromptPolicyState): Promise<string> {
  if (!state.deviceId || state.entityId === null || state.entityId === undefined || !state.botSecret) {
    return "";
  }

  const params = new URLSearchParams({
    deviceId: state.deviceId,
    entityId: String(state.entityId),
    botSecret: state.botSecret,
    channel: state.channel || "claude_code",
  });

  const response = await fetch(`${state.apiBase}/api/channel/prompt-policy?${params.toString()}`);
  if (!response.ok) return "";

  const data = (await response.json().catch(() => ({}))) as PromptPolicyResponse;
  if (data.success === false) return "";
  return data.policy?.compiledPrompt?.trim() || "";
}

export function applyCompiledPromptPolicy(message: string, compiledPrompt: string): string {
  const policy = compiledPrompt.trim();
  if (!policy) return message;
  return [
    "[EClaw managed prompt policy - claude_code]",
    policy,
    "[End EClaw managed prompt policy]",
    "",
    message,
  ].join("\n");
}
