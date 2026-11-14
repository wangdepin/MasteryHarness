/**
 * The page an unpaired browser sees instead of the app.
 *
 * Self-contained on purpose: no script, no stylesheet, no font and no app
 * layout, because everything else the server offers is behind the gate this
 * page opens. The fixed user name lets a password manager file the token.
 */

export const PAIR_PATH = "/api/access/pair";
export const PAIRING_USERNAME = "masteryharness";

export type PairingProblem = "wrong-token" | "too-many-attempts";

const PROBLEM_TEXT: Record<PairingProblem, string> = {
	"wrong-token": "That token didn't match. Try again.",
	"too-many-attempts": "Too many attempts. Wait a minute, then try again.",
};

const STYLE = `
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#141414;color:#e6e6e6;font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:22rem;padding:2rem 1.25rem;box-sizing:border-box}
h1{margin:0 0 1.5rem;font-size:1.5rem;font-weight:600}
p{margin:0 0 .25rem}
.problem{margin:1rem 0 0;color:#f0a8a8}
input[type=password]{display:block;width:100%;box-sizing:border-box;margin:1.5rem 0 1rem;padding:.75rem;border:1px solid #3a3a3a;border-radius:8px;background:#1c1c1c;color:inherit;font:inherit}
button{display:block;width:100%;padding:.75rem;border:0;border-radius:8px;background:#e6e6e6;color:#141414;font:inherit;font-weight:600}
`;

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function pairingPage({ next, problem }: { next: string; problem?: PairingProblem }): string {
	const notice = problem ? `<p class="problem" role="alert">${PROBLEM_TEXT[problem]}</p>` : "";
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>MasteryHarness</title>
<style>${STYLE}</style>
<main>
<h1>MasteryHarness</h1>
<p>This device isn't paired yet.</p>
<p>Paste the access token from your Mac.</p>
${notice}
<form method="post" action="${PAIR_PATH}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<input type="text" name="username" value="${PAIRING_USERNAME}" autocomplete="username" readonly hidden>
<input type="password" name="token" aria-label="Access token" placeholder="Access token" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required>
<button type="submit">Pair this device</button>
</form>
</main>
</html>`;
}
