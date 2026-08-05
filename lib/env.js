const fs = require("fs");
const path = require("path");

const ENV_ALIASES = {
    TIKTOK_USERNAME: ["username", "tiktok_username"],
    TIKTOK_SESSION_ID: ["session_id", "sessionid", "tiktok_session_id"],
    TIKTOK_TT_TARGET_IDC: ["tt_target_idc", "tiktok_tt_target_idc"]
};

function resolveEnvKey(key) {
    const normalized = String(key || "").trim();
    if (!normalized) return "";

    const upperKey = normalized.toUpperCase();
    if (ENV_ALIASES[upperKey]) return upperKey;

    const lowerKey = normalized.toLowerCase();
    for (const [canonicalKey, aliases] of Object.entries(ENV_ALIASES)) {
        if (aliases.includes(lowerKey)) {
            return canonicalKey;
        }
    }

    return upperKey;
}

function parseEnvFile(filename = ".env") {
    const envPath = path.join(__dirname, "..", filename);
    if (!fs.existsSync(envPath)) {
        return { envPath, lines: [], values: {} };
    }

    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    const values = {};

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) continue;

        const key = resolveEnvKey(line.slice(0, separatorIndex).trim());
        let value = line.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return { envPath, lines, values };
}

function loadEnvFile(filename = ".env") {
    const { values } = parseEnvFile(filename);
    for (const [key, value] of Object.entries(values)) {
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function formatEnvValue(value) {
    const stringValue = String(value ?? "");
    if (!stringValue) return "";
    if (/[\s#"'`]/.test(stringValue)) {
        return JSON.stringify(stringValue);
    }
    return stringValue;
}

function updateEnvFile(filename = ".env", updates = {}) {
    const { envPath, lines } = parseEnvFile(filename);
    const normalizedUpdates = Object.fromEntries(
        Object.entries(updates)
            .map(([key, value]) => [resolveEnvKey(key), String(value ?? "")])
            .filter(([key, value]) => key && value !== "")
    );

    if (!Object.keys(normalizedUpdates).length) {
        return { updatedKeys: [], envPath };
    }

    const seenKeys = new Set();
    const nextLines = lines.map((rawLine) => {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith("#")) return rawLine;

        const separatorIndex = rawLine.indexOf("=");
        if (separatorIndex <= 0) return rawLine;

        const originalKey = rawLine.slice(0, separatorIndex).trim();
        const resolvedKey = resolveEnvKey(originalKey);
        if (!(resolvedKey in normalizedUpdates)) return rawLine;

        seenKeys.add(resolvedKey);
        return `${originalKey}=${formatEnvValue(normalizedUpdates[resolvedKey])}`;
    });

    for (const [key, value] of Object.entries(normalizedUpdates)) {
        if (seenKeys.has(key)) continue;
        nextLines.push(`${key}=${formatEnvValue(value)}`);
    }

    fs.writeFileSync(envPath, nextLines.join("\n"));

    for (const [key, value] of Object.entries(normalizedUpdates)) {
        process.env[key] = value;
    }

    return { updatedKeys: Object.keys(normalizedUpdates), envPath };
}

module.exports = {
    ENV_ALIASES,
    loadEnvFile,
    parseEnvFile,
    resolveEnvKey,
    updateEnvFile
};
