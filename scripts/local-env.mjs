import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseLocalEnvContent(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex === -1) {
      throw new Error(`Invalid .env line: ${rawLine}`);
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();

    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid .env key: ${key}`);
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();

    if (value.length >= 2) {
      const quote = value[0];
      const lastCharacter = value.at(-1);

      if ((quote === '"' || quote === "'") && lastCharacter === quote) {
        value = value.slice(1, -1);
      }
    }

    values[key] = value;
  }

  return values;
}

export function applyLocalEnv(targetEnv, values, options = {}) {
  const { override = false } = options;

  for (const [key, value] of Object.entries(values)) {
    if (override || targetEnv[key] === undefined) {
      targetEnv[key] = value;
    }
  }

  return targetEnv;
}

export function loadLocalEnv(options = {}) {
  const {
    cwd = process.cwd(),
    override = false,
    targetEnv = process.env,
  } = options;
  const envPath = path.join(cwd, ".env");

  if (!fs.existsSync(envPath)) {
    return {};
  }

  const parsedValues = parseLocalEnvContent(fs.readFileSync(envPath, "utf8"));

  applyLocalEnv(targetEnv, parsedValues, { override });

  return parsedValues;
}
