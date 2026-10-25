/**
 * Subscription sign-in (owner, 2026-10-21): drives pi-ai's own OAuth login
 * flows (ChatGPT, Claude) for the settings page. One in-memory login
 * session per attempt; the page polls its view, opens the browser on
 * `authUrl`, and — when a flow asks — submits a pasted authorization code.
 * Tokens never leave the server: views carry status text only, and pi-ai
 * persists the credential through the bound file store.
 */
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { piModels } from "../agent/models.ts";
import { SUBSCRIPTION_PROVIDERS, type OAuthLoginView, type OAuthProviderRow } from "../core/oauth-login.ts";
import { hasOAuthCredential, installationId } from "../store/oauth-credentials.ts";

interface Session {
	view: OAuthLoginView;
	abort: AbortController;
	/** Resolves the pending manual-code prompt, if one is open. */
	submitCode?: (code: string) => void;
	finishedAt?: number;
}

const FINISHED_TTL_MS = 10 * 60 * 1000;

// Anchored on globalThis: Next re-imports modules per route bundle / HMR,
// and the start and poll routes must see the same sessions.
const holder = globalThis as unknown as { __lhOAuthSessions?: Map<string, Session> };
const sessions = (holder.__lhOAuthSessions ??= new Map<string, Session>());

function sweep(): void {
	const now = Date.now();
	for (const [id, s] of sessions) if (s.finishedAt !== undefined && now - s.finishedAt > FINISHED_TTL_MS) sessions.delete(id);
}

function interactionFor(session: Session): AuthInteraction & { signal: AbortSignal } {
	const { view, abort } = session;
	return {
		signal: abort.signal,
		notify(event: AuthEvent) {
			if (event.type === "auth_url") {
				view.authUrl = event.url;
				view.instructions = event.instructions;
				view.status = "awaiting_browser";
			} else if (event.type === "device_code") {
				view.deviceCode = { userCode: event.userCode, verificationUri: event.verificationUri };
				view.status = "awaiting_browser";
			} else if (event.type === "progress" || event.type === "info") {
				view.message = event.message;
			}
		},
		prompt(prompt: AuthPrompt) {
			// Copilot asks for a GitHub Enterprise domain first. Owner scope
			// (2026-10-25): github.com only, so blank is the one answer.
			if (prompt.type === "text" && view.provider === "github-copilot") return Promise.resolve("");
			if (prompt.type !== "manual_code") return Promise.reject(new Error(`unsupported login prompt: ${prompt.type}`));
			return new Promise<string>((resolve, reject) => {
				view.status = "awaiting_code";
				view.codePrompt = prompt.message;
				// The flow races this prompt against its callback server and
				// aborts the prompt when the callback wins: fall back to waiting.
				const cancelled = () => {
					session.submitCode = undefined;
					if (view.status === "awaiting_code") view.status = "awaiting_browser";
					view.codePrompt = undefined;
					reject(new Error("prompt cancelled"));
				};
				prompt.signal?.addEventListener("abort", cancelled, { once: true });
				abort.signal.addEventListener("abort", cancelled, { once: true });
				session.submitCode = (code) => {
					session.submitCode = undefined;
					view.status = "awaiting_browser";
					view.codePrompt = undefined;
					resolve(code);
				};
			});
		},
	};
}

/** Begin a login for `provider`; any earlier attempt for it is cancelled. */
export function startLogin(provider: string): OAuthLoginView {
	sweep();
	for (const [id, s] of sessions) {
		if (s.view.provider === provider && s.finishedAt === undefined) {
			s.abort.abort();
			sessions.delete(id);
		}
	}
	const loginId = crypto.randomUUID();
	const session: Session = { view: { loginId, provider, status: "starting" }, abort: new AbortController() };
	sessions.set(loginId, session);

	void piModels()
		.login(provider, "oauth", interactionFor(session), { getDeviceId: installationId, agentName: "LearnHarness" })
		.then(() => {
			session.view = { loginId, provider, status: "done" };
		})
		.catch((err: unknown) => {
			if (session.abort.signal.aborted) return;
			session.view = { loginId, provider, status: "error", error: err instanceof Error ? err.message : String(err) };
		})
		.finally(() => {
			session.finishedAt = Date.now();
			session.submitCode = undefined;
		});
	return session.view;
}

export function loginView(loginId: string): OAuthLoginView | null {
	return sessions.get(loginId)?.view ?? null;
}

/** Hand a pasted authorization code to the flow that is waiting for one. */
export function submitLoginCode(loginId: string, code: string): "ok" | "unknown" | "not-waiting" {
	const session = sessions.get(loginId);
	if (!session) return "unknown";
	if (!session.submitCode) return "not-waiting";
	session.submitCode(code);
	return "ok";
}

export function cancelLogin(loginId: string): boolean {
	const session = sessions.get(loginId);
	if (!session) return false;
	session.abort.abort();
	sessions.delete(loginId);
	return true;
}

export async function signOut(provider: string): Promise<void> {
	await piModels().logout(provider);
}

/** The settings page's rows: every offered provider that has an OAuth flow. */
export function oauthProviderRows(): OAuthProviderRow[] {
	const rows: OAuthProviderRow[] = [];
	for (const offered of SUBSCRIPTION_PROVIDERS) {
		const oauth = piModels().getProvider(offered.id)?.auth.oauth;
		if (!oauth) continue;
		rows.push({ id: offered.id, label: offered.label, planName: oauth.name, signedIn: hasOAuthCredential(offered.id) });
	}
	return rows;
}
