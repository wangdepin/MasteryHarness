/**
 * Subscription sign-in pure layer (owner, 2026-10-21): which providers offer
 * "sign in with your plan" and the request/response contract of the
 * /api/auth/oauth routes. No I/O.
 */

/** Providers offered for subscription sign-in (owner scope: ChatGPT, Claude,
 *  GitHub Copilot and Grok through pi-ai's own login flows, plus Google
 *  Antigravity through the vendored provider in src/agent/providers/antigravity). */
export const SUBSCRIPTION_PROVIDERS: readonly { id: string; label: string }[] = [
	{ id: "openai", label: "ChatGPT" },
	{ id: "anthropic", label: "Claude" },
	{ id: "antigravity", label: "Google (Antigravity)" },
	{ id: "github-copilot", label: "GitHub Copilot" },
	{ id: "xai", label: "Grok" },
];

export function isSubscriptionProvider(id: unknown): id is string {
	return typeof id === "string" && SUBSCRIPTION_PROVIDERS.some((p) => p.id === id);
}

export type OAuthLoginStatus = "starting" | "awaiting_browser" | "awaiting_code" | "done" | "error";

/** One login attempt as the page sees it — never carries a token. */
export interface OAuthLoginView {
	loginId: string;
	provider: string;
	status: OAuthLoginStatus;
	/** The page to open in the browser (present from `awaiting_browser`). */
	authUrl?: string;
	instructions?: string;
	/** Device-code flows: the code to type on `verificationUri`. */
	deviceCode?: { userCode: string; verificationUri: string };
	/** Set while `awaiting_code`: what to paste. */
	codePrompt?: string;
	message?: string;
	error?: string;
}

/** One provider row of GET /api/auth/oauth. */
export interface OAuthProviderRow {
	id: string;
	label: string;
	/** pi-ai's name for the plan, e.g. "Anthropic (Claude Pro/Max)". */
	planName: string;
	signedIn: boolean;
}

export type OAuthBodyResult<T> = { ok: true; value: T } | { ok: false; error: string };

function record(body: unknown): Record<string, unknown> | null {
	return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** POST /api/auth/oauth/start body. */
export function parseStartBody(body: unknown): OAuthBodyResult<{ provider: string }> {
	const raw = record(body);
	if (!raw || !isSubscriptionProvider(raw.provider)) {
		return { ok: false, error: `provider must be one of: ${SUBSCRIPTION_PROVIDERS.map((p) => p.id).join(", ")}` };
	}
	return { ok: true, value: { provider: raw.provider } };
}

/** POST /api/auth/oauth/code body. */
export function parseCodeBody(body: unknown): OAuthBodyResult<{ loginId: string; code: string }> {
	const raw = record(body);
	if (!raw || typeof raw.loginId !== "string" || raw.loginId === "") return { ok: false, error: "loginId is required" };
	if (typeof raw.code !== "string" || raw.code.trim() === "") return { ok: false, error: "code must be a non-empty string" };
	if (raw.code.length > 4000) return { ok: false, error: "code is too long" };
	return { ok: true, value: { loginId: raw.loginId, code: raw.code.trim() } };
}
