import {
	createProvider,
	type Context,
	type OAuthCredential,
	type Provider,
	type ProviderAuthInteraction,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@earendil-works/pi-ai";
import { getApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth.ts";
import { ANTIGRAVITY_MODELS, PROVIDER_ID, PROVIDER_NAME } from "./models.ts";
import { streamAntigravity } from "./stream.ts";
import { ANTIGRAVITY_API } from "./types.ts";

/**
 * Google Antigravity as a pi-ai provider (owner, 2026-10-21): sign in with a
 * Google account, no API key. The wire protocol is vendored from
 * pi-antigravity (MIT, see LICENSE-pi-antigravity) — an UNOFFICIAL, reverse
 * engineered client of Google's internal Cloud Code Assist endpoints that
 * borrows the Antigravity desktop app's OAuth identity. It can break whenever
 * Google changes the backend, and it may violate Google's terms.
 */

async function login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
	const credentials = await loginAntigravity({
		signal: interaction.signal,
		onAuth: ({ url, instructions }) => interaction.notify({ type: "auth_url", url, instructions }),
		// Browsers that cannot reach localhost:51121 hand back the callback URL by paste.
		onPrompt: ({ message, placeholder }) => interaction.prompt({ type: "manual_code", message, placeholder }),
	});
	return { ...credentials, type: "oauth" };
}

async function refresh(credential: OAuthCredential): Promise<OAuthCredential> {
	const refreshed = await refreshAntigravityToken(credential);
	return { ...refreshed, type: "oauth" };
}

// stream.ts reads the system prompt and tools out of the transcript itself,
// so the opaque TranscriptContext passes straight through.
const api = {
	stream: (model: Parameters<typeof streamAntigravity>[0], context: unknown, options?: StreamOptions) =>
		streamAntigravity(model, context as Context, options as SimpleStreamOptions | undefined),
	streamSimple: (model: Parameters<typeof streamAntigravity>[0], context: unknown, options?: SimpleStreamOptions) =>
		streamAntigravity(model, context as Context, options),
};

/** The provider to register in the process-wide pi-ai Models collection. */
export function antigravityProvider(): Provider<typeof ANTIGRAVITY_API> {
	return createProvider({
		id: PROVIDER_ID,
		name: PROVIDER_NAME,
		auth: {
			oauth: {
				name: "Google Antigravity (Gemini, Claude, GPT-OSS)",
				isSubscription: true,
				loginLabel: "Sign in with Google",
				login,
				refresh,
				toAuth: async (credential) => ({ apiKey: getApiKey(credential) }),
			},
		},
		models: ANTIGRAVITY_MODELS,
		api,
	});
}

export { PROVIDER_ID as ANTIGRAVITY_PROVIDER_ID };
