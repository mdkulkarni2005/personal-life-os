import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const utilsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(utilsDir, "..");

const ENV_FILES = [".env", ".env.local"];

const envCache = new Map<string, Map<string, string>>();

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(filePath: string) {
  const values = new Map<string, string>();

  if (!fs.existsSync(filePath)) {
    return values;
  }

  const contents = fs.readFileSync(filePath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (!key) continue;

    const rawValue = match[2] ?? "";
    values.set(key, stripWrappingQuotes(rawValue.trim()));
  }

  return values;
}

function loadEnvFiles(rootDir: string) {
  const cached = envCache.get(rootDir);
  if (cached) return cached;

  const merged = new Map<string, string>();

  for (const fileName of ENV_FILES) {
    const filePath = path.join(rootDir, fileName);
    for (const [key, value] of parseEnvFile(filePath)) {
      merged.set(key, value);
    }
  }

  envCache.set(rootDir, merged);
  return merged;
}

export function resolveE2EEnv(name: string, rootDir = appDir) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;

  return loadEnvFiles(rootDir).get(name)?.trim();
}

export function hasLoginCredentials(rootDir = appDir) {
  return Boolean(
    resolveE2EEnv("E2E_USER_EMAIL", rootDir) && resolveE2EEnv("E2E_USER_PASSWORD", rootDir),
  );
}
