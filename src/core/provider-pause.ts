/**
 * Paused model sources (owner, 2026-11-13): a provider id listed in the
 * settings record's `pausedProviders` keeps its credentials, but its models
 * leave every picker and new requests on it are refused until it is turned
 * back on. Claude Code keeps its own enable switch (`claudeCode.enabled`)
 * and is never paused here. Pure, browser-safe.
 */
import { AUTH_PROVIDER_KEYS, CUSTOM_PROVIDER } from "./auth-keys.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import { NATIVE_SUBSCRIPTIONS } from "./contracts/subscriptions.ts";
import { SUBSCRIPTION_PROVIDERS } from "./oauth-login.ts";

/** Upper bound on stored paused ids; far above the number of real providers. */
export const MAX_PAUSED_PROVIDERS = 200;

/** The refusal wording's invariant tail — the client matcher keys on it. */
export const PROVIDER_PAUSED_TAIL = "is paused — turn it back on in Settings → Providers";

/** Can this provider be paused? Every model source except Claude Code. */
export function isPausableProvider(provider: string): boolean {
	return provider !== "" && provider !== CLAUDE_CODE_PROVIDER;
}

/** The stored list: unique pausable ids, sorted, bounded. Anything else → []. */
export function sanitizePausedProviders(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const ids = new Set<string>();
	for (const id of raw) if (typeof id === "string" && isPausableProvider(id)) ids.add(id);
	return [...ids].sort().slice(0, MAX_PAUSED_PROVIDERS);
}

/** The name a person knows a provider by, e.g. "OpenAI", "ChatGPT", "Grok". */
export function providerLabel(provider: string): string {
	if (provider === "chatgpt") return "ChatGPT";
	if (provider === CUSTOM_PROVIDER.id) return CUSTOM_PROVIDER.label;
	return NATIVE_SUBSCRIPTIONS.find((p) => p.logicalId === provider)?.label
		?? AUTH_PROVIDER_KEYS.find((p) => p.id === provider)?.label
		?? SUBSCRIPTION_PROVIDERS.find((p) => p.id === provider)?.label
		?? provider;
}

/** Human-readable refusal for a paused provider — safe to render as-is. */
export function providerPausedMessage(provider: string): string {
	return `${providerLabel(provider)} ${PROVIDER_PAUSED_TAIL}`;
}
