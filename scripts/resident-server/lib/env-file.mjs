/**
 * Reads server.env: KEY=VALUE lines, `#` comments, optional matching quotes.
 * No interpolation and no `export`: the file is data, not a shell script.
 */
import * as fs from "node:fs";

const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function unquote(value) {
	const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
	return quoted ? value.slice(1, -1) : value;
}

export function parseEnvFile(text) {
	const env = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = LINE.exec(line);
		if (!match) throw new Error(`server.env: cannot read the line "${line.slice(0, 40)}"`);
		env[match[1]] = unquote(match[2].trim());
	}
	return env;
}

/** The file holds the access token: refuse one that other accounts can read. */
export function readEnvFile(file) {
	const mode = fs.statSync(file).mode & 0o777;
	if (mode & 0o077) throw new Error(`${file} is readable by other accounts (mode ${mode.toString(8)}). Run: chmod 600 "${file}"`);
	return parseEnvFile(fs.readFileSync(file, "utf8"));
}
