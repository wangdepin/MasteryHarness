/**
 * The access token opens the whole app, so no child process may inherit it:
 * not an external CLI, not a headless browser, not learner-written code.
 */
export function withoutAccessToken<T extends Record<string, string | undefined>>(env: T): T {
	const result = { ...env };
	delete result.LH_ACCESS_TOKEN;
	return result;
}
