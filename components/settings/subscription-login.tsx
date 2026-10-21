"use client";

/**
 * "Subscription sign-in" group of the Keys section (owner, 2026-10-21): use
 * a ChatGPT or Claude plan instead of an API key. Sign in opens the
 * provider's page in the browser; flows that cannot reach the local
 * callback ask for the authorization code pasted back. The server holds the
 * tokens — this component only ever sees status.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { OAuthLoginView, OAuthProviderRow } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { SettingsGroup } from "./controls.tsx";

const POLL_MS = 1000;

function statusText(view: OAuthLoginView): string {
	switch (view.status) {
		case "starting":
			return "Starting…";
		case "awaiting_browser":
			return view.deviceCode ? `Enter code ${view.deviceCode.userCode} on the page that opened` : "Waiting for you to finish in the browser…";
		case "awaiting_code":
			return view.codePrompt ?? "Paste the authorization code";
		case "done":
			return "Signed in";
		case "error":
			return view.error ?? "Sign-in failed";
	}
}

function ProviderRow({ row, onChanged }: { row: OAuthProviderRow; onChanged: () => void }) {
	const [login, setLogin] = useState<OAuthLoginView | null>(null);
	const [code, setCode] = useState("");
	const opened = useRef<string | null>(null);

	const poll = useCallback(async (loginId: string) => {
		const res = await fetch(`/api/auth/oauth/${loginId}`).catch(() => null);
		if (!res?.ok) return;
		setLogin((await res.json()) as OAuthLoginView);
	}, []);

	const active = login !== null && login.status !== "done" && login.status !== "error";
	useEffect(() => {
		if (!active || !login) return;
		const timer = setInterval(() => void poll(login.loginId), POLL_MS);
		return () => clearInterval(timer);
	}, [active, login, poll]);

	// Open the provider's page once per attempt, as soon as the flow has one.
	useEffect(() => {
		if (login?.authUrl && opened.current !== login.loginId) {
			opened.current = login.loginId;
			window.open(login.authUrl, "_blank", "noopener");
		}
	}, [login]);

	useEffect(() => {
		if (login?.status === "done") {
			onChanged();
			notifySettingsSaved("keys");
		}
	}, [login?.status, onChanged]);

	async function start() {
		setCode("");
		const res = await fetch("/api/auth/oauth/start", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: row.id }),
		}).catch(() => null);
		if (res?.ok) setLogin((await res.json()) as OAuthLoginView);
		else setLogin({ loginId: "", provider: row.id, status: "error", error: "Could not start sign-in" });
	}

	async function cancel() {
		if (login?.loginId) await fetch(`/api/auth/oauth/${login.loginId}`, { method: "DELETE" }).catch(() => undefined);
		setLogin(null);
	}

	async function submitCode() {
		if (!login || code.trim() === "") return;
		const res = await fetch("/api/auth/oauth/code", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ loginId: login.loginId, code }),
		}).catch(() => null);
		if (res?.ok) {
			setCode("");
			setLogin((await res.json()) as OAuthLoginView);
		}
	}

	async function signOut() {
		await fetch(`/api/auth/oauth/provider/${row.id}`, { method: "DELETE" }).catch(() => undefined);
		setLogin(null);
		onChanged();
		notifySettingsSaved("keys");
	}

	return (
		<div className="flex flex-col gap-1.5 px-1 py-1.5" data-testid={`subscription-${row.id}`}>
			<div className="flex items-center justify-between gap-3">
				<span className="font-ui text-xs text-foreground" title={row.planName}>
					{row.label}
				</span>
				<span className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
					{row.signedIn ? "Signed in" : "Not signed in"}
					{row.signedIn ? (
						<button type="button" onClick={() => void signOut()} className="hover:text-foreground" data-testid={`subscription-${row.id}-signout`}>
							Sign out
						</button>
					) : active ? (
						<button type="button" onClick={() => void cancel()} className="hover:text-foreground">
							Cancel
						</button>
					) : (
						<button type="button" onClick={() => void start()} className="hover:text-foreground" data-testid={`subscription-${row.id}-signin`}>
							Sign in
						</button>
					)}
				</span>
			</div>
			{login && !row.signedIn && (
				<div className="flex flex-col gap-1.5 font-mono text-[11px] text-muted-foreground" data-testid={`subscription-${row.id}-status`}>
					<span className={login.status === "error" ? "text-destructive" : undefined}>{statusText(login)}</span>
					{login.authUrl && login.status !== "done" && (
						<a href={login.authUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
							Open the sign-in page again
						</a>
					)}
					{login.status === "awaiting_code" && (
						<span className="flex items-center gap-2">
							<input
								value={code}
								onChange={(e) => setCode(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && void submitCode()}
								placeholder="Authorization code or callback URL"
								className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-1 text-foreground"
							/>
							<button type="button" onClick={() => void submitCode()} className="hover:text-foreground">
								Submit
							</button>
						</span>
					)}
				</div>
			)}
		</div>
	);
}

export function SubscriptionLogin() {
	const [rows, setRows] = useState<OAuthProviderRow[] | null>(null);
	const reload = useCallback(() => {
		void fetch("/api/auth/oauth")
			.then((r) => r.json())
			.then((body: { providers?: OAuthProviderRow[] }) => setRows(body.providers ?? []))
			.catch(() => setRows([]));
	}, []);
	useEffect(reload, [reload]);

	if (rows === null || rows.length === 0) return null;
	return (
		<SettingsGroup label="Subscription sign-in" testid="group-subscription-login">
			{rows.map((row) => (
				<ProviderRow key={row.id} row={row} onChanged={reload} />
			))}
			<p className="px-1 pt-1 text-[11px] leading-relaxed text-muted-foreground/70">
				Uses your own plan instead of an API key. Third-party use of a subscription may be against the provider&apos;s terms and could put the account at risk.
			</p>
			{rows.some((r) => r.id === "antigravity") && (
				<p className="px-1 pt-1 text-[11px] leading-relaxed text-muted-foreground/70" data-testid="antigravity-disclaimer">
					Google (Antigravity) is an unofficial route: it signs in as Google&apos;s Antigravity app and calls internal endpoints that can change or stop working at any time. Use an account you can afford to lose.
				</p>
			)}
		</SettingsGroup>
	);
}
