/**
 * File-backed pi-ai CredentialStore for subscription sign-in (owner,
 * 2026-10-21): one type-tagged credential per provider id in
 * config.OAUTH_FILE. 0600, atomic writes, re-read from disk on every
 * access (hand-edits and a second process keep working). Writes go
 * through `modify` only and are serialized, so a token refresh and a
 * login can never interleave.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { OAUTH_FILE } from "../../config.ts";

type CredentialMap = Record<string, Credential>;

function isCredential(v: unknown): v is Credential {
	if (v === null || typeof v !== "object") return false;
	const type = (v as { type?: unknown }).type;
	return type === "api_key" || type === "oauth";
}

function readMap(file: string): CredentialMap {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(Object.entries(raw).filter(([, v]) => isCredential(v))) as CredentialMap;
	} catch {
		return {}; // absent or corrupt — "nobody is signed in"
	}
}

function writeMap(file: string, map: CredentialMap): void {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.oauth-credentials.json.tmp-${process.pid}`);
	fs.writeFileSync(tmp, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600 });
	fs.chmodSync(tmp, 0o600);
	fs.renameSync(tmp, file);
}

export class FileCredentialStore implements CredentialStore {
	private chain: Promise<unknown> = Promise.resolve();

	constructor(private readonly file: string) {}

	private enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.chain.then(task, task);
		this.chain = run.catch(() => undefined);
		return run;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		return readMap(this.file)[providerId];
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(readMap(this.file)).map(([providerId, c]) => ({ providerId, type: c.type }));
	}

	modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
		return this.enqueue(async () => {
			const map = readMap(this.file);
			const next = await fn(map[providerId]);
			if (next === undefined) return map[providerId];
			map[providerId] = next;
			writeMap(this.file, map);
			return next;
		});
	}

	delete(providerId: string): Promise<void> {
		return this.enqueue(async () => {
			const map = readMap(this.file);
			if (!(providerId in map)) return;
			delete map[providerId];
			writeMap(this.file, map);
		});
	}
}

export const oauthCredentialStore = new FileCredentialStore(OAUTH_FILE);

/** Sync "is this provider signed in with a subscription?" — the catalog's
 *  keyPresent gate is synchronous. */
export function hasOAuthCredential(providerId: string, file: string = OAUTH_FILE): boolean {
	return readMap(file)[providerId]?.type === "oauth";
}

/** Sync read of one provider's subscription credential, for catalog code
 *  that cannot await (it never leaves the server). */
export function readOAuthCredential(providerId: string, file: string = OAUTH_FILE): Credential | undefined {
	const credential = readMap(file)[providerId];
	return credential?.type === "oauth" ? credential : undefined;
}

/** The stable id of this app installation (pi-ai login flows send it to
 *  the provider); created on first use, then returned unchanged. */
export function installationId(file: string = path.join(path.dirname(OAUTH_FILE), "installation-id")): string {
	try {
		const existing = fs.readFileSync(file, "utf-8").trim();
		if (existing !== "") return existing;
	} catch {
		// first use
	}
	const id = crypto.randomUUID();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
	return id;
}
