const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Buffer } = require("buffer");
const { execFileSync } = require("child_process");

const { updateEnvFile } = require("./env");

const CHROME_COOKIE_NAMES = new Set(["sessionid", "tt_target_idc"]);
const CHROME_BASE_DIR = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
const KEYCHAIN_PROBES = [
    ["find-generic-password", "-w", "-s", "Chrome Safe Storage"],
    ["find-generic-password", "-w", "-s", "Google Chrome Safe Storage"],
    ["find-generic-password", "-w", "-a", "Chrome"],
    ["find-generic-password", "-w", "-a", "Google Chrome"]
];
let lastSyncSignature = "";
let lastCookieDbSignature = "";
let lastSyncResult = null;

function chromeUtcToUnixMs(value) {
    const numberValue = Number(value || 0);
    if (!numberValue) return 0;
    return Math.max(0, Math.floor(numberValue / 1000) - 11644473600000);
}

function getChromeProfiles() {
    if (process.platform !== "darwin" || !fs.existsSync(CHROME_BASE_DIR)) return [];

    return fs.readdirSync(CHROME_BASE_DIR)
        .filter((entry) => entry === "Default" || entry === "Guest Profile" || entry.startsWith("Profile "))
        .map((entry) => ({
            name: entry,
            cookiePath: path.join(CHROME_BASE_DIR, entry, "Cookies")
        }))
        .filter((entry) => fs.existsSync(entry.cookiePath));
}

function getCookieDbSignature(profiles) {
    return JSON.stringify(
        profiles.map((profile) => {
            const stats = fs.statSync(profile.cookiePath);
            return {
                name: profile.name,
                mtimeMs: stats.mtimeMs,
                size: stats.size
            };
        })
    );
}

function copyCookieDb(cookiePath) {
    const tempPath = path.join(os.tmpdir(), `gamerankpaistik-${process.pid}-${Date.now()}-${path.basename(path.dirname(cookiePath))}.sqlite`);
    fs.copyFileSync(cookiePath, tempPath);
    return tempPath;
}

function readChromeSafeStorageKey() {
    for (const args of KEYCHAIN_PROBES) {
        try {
            const secret = execFileSync("security", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
            if (!secret) continue;
            return crypto.pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1");
        } catch {
            // Continúa con las etiquetas conocidas del Keychain.
        }
    }
    return null;
}

function decryptChromeCookie(encryptedHex, key) {
    if (!encryptedHex) return "";

    const encryptedBytes = Buffer.from(encryptedHex, "hex");
    if (!encryptedBytes.length) return "";

    const prefix = encryptedBytes.subarray(0, 3).toString("utf8");
    if ((prefix !== "v10" && prefix !== "v11") || !key) return "";

    try {
        const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
        const decryptedBytes = Buffer.concat([
            decipher.update(encryptedBytes.subarray(3)),
            decipher.final()
        ]);

        // La base de cookies de Chrome v24+ antepone SHA256(host_key) al texto plano.
        const payloadBytes = decryptedBytes.length > 32 ? decryptedBytes.subarray(32) : decryptedBytes;
        return payloadBytes.toString("utf8");
    } catch {
        return "";
    }
}

function readCookiesFromProfile(profile, key) {
    const tempPath = copyCookieDb(profile.cookiePath);

    try {
        const query = [
            "select",
            "name,",
            "value,",
            "hex(encrypted_value),",
            "last_update_utc,",
            "last_access_utc",
            "from cookies",
            "where host_key like '%tiktok.com%'",
            "and name in ('sessionid','tt_target_idc')"
        ].join(" ");

        const output = execFileSync("sqlite3", [tempPath, "-separator", "\t", query], { stdio: ["ignore", "pipe", "ignore"] }).toString();
        const cookies = [];

        for (const line of output.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const [name, plainValue, encryptedHex, lastUpdateUtc, lastAccessUtc] = line.split("\t");
            if (!CHROME_COOKIE_NAMES.has(name)) continue;

            const decryptedValue = plainValue || decryptChromeCookie(encryptedHex, key);
            if (!decryptedValue) continue;

            cookies.push({
                profile: profile.name,
                name,
                value: decryptedValue,
                updatedAt: Math.max(chromeUtcToUnixMs(lastUpdateUtc), chromeUtcToUnixMs(lastAccessUtc))
            });
        }

        return cookies;
    } finally {
        fs.rmSync(tempPath, { force: true });
    }
}

function collectTikTokCookies() {
    const profiles = getChromeProfiles();
    if (!profiles.length) {
        return { cookies: {}, errors: ["No se encontraron perfiles de Chrome con base de cookies."], signature: "" };
    }

    const signature = getCookieDbSignature(profiles);
    if (signature === lastCookieDbSignature && lastSyncResult) {
        return {
            cookies: lastSyncResult.cookies,
            errors: lastSyncResult.errors,
            signature,
            fromCache: true
        };
    }

    const key = readChromeSafeStorageKey();
    if (!key) {
        return { cookies: {}, errors: ["No se pudo leer la clave 'Chrome Safe Storage' del Keychain."], signature };
    }

    const freshestByName = {};
    const errors = [];
    for (const profile of profiles) {
        try {
            const cookies = readCookiesFromProfile(profile, key);
            for (const cookie of cookies) {
                const current = freshestByName[cookie.name];
                if (!current || cookie.updatedAt >= current.updatedAt) {
                    freshestByName[cookie.name] = cookie;
                }
            }
        } catch (error) {
            errors.push(`Perfil ${profile.name}: ${error.message}`);
        }
    }

    lastCookieDbSignature = signature;
    lastSyncResult = { cookies: freshestByName, errors };

    return { cookies: freshestByName, errors, signature, fromCache: false };
}

function syncTikTokEnvFromChrome(options = {}) {
    const filename = options.filename || ".env";
    const logger = options.logger || console;

    if (process.platform !== "darwin") {
        logger.log("[tiktok-auth] La sincronización automática de Chrome solo está disponible en macOS. En Windows, actualiza TIKTOK_SESSION_ID en el archivo .env manualmente si el Live no conecta.");
        return { updatedKeys: [], missingKeys: ["sessionid", "tt_target_idc"], errors: ["Sincronización no disponible en Windows."] };
    }

    const { cookies, errors } = collectTikTokCookies();
    const updates = {};
    const updatedKeys = [];
    const missingKeys = [];

    const sessionCookie = cookies.sessionid;
    const targetIdcCookie = cookies.tt_target_idc;

    if (sessionCookie?.value) {
        if (process.env.TIKTOK_SESSION_ID !== sessionCookie.value) {
            updates.TIKTOK_SESSION_ID = sessionCookie.value;
            updatedKeys.push("TIKTOK_SESSION_ID");
        }
    } else {
        missingKeys.push("sessionid");
    }

    if (targetIdcCookie?.value) {
        if (process.env.TIKTOK_TT_TARGET_IDC !== targetIdcCookie.value) {
            updates.TIKTOK_TT_TARGET_IDC = targetIdcCookie.value;
            updatedKeys.push("TIKTOK_TT_TARGET_IDC");
        }
    } else {
        missingKeys.push("tt_target_idc");
    }

    if (Object.keys(updates).length) {
        updateEnvFile(filename, updates);
    }

    const nextSignature = JSON.stringify({ missingKeys, errors });
    const shouldLogStatus = nextSignature !== lastSyncSignature;

    if (updatedKeys.length) {
        logger.log(`[tiktok-auth] Credenciales actualizadas desde Chrome: ${updatedKeys.join(", ")}`);
    }
    if (shouldLogStatus && missingKeys.length) {
        logger.log(`[tiktok-auth] No se pudo actualizar automáticamente: ${missingKeys.join(", ")}`);
    }
    if (shouldLogStatus) {
        for (const error of errors) {
            logger.log(`[tiktok-auth] ${error}`);
        }
    }
    lastSyncSignature = nextSignature;

    return {
        updatedKeys,
        missingKeys,
        errors,
        cookieProfiles: {
            sessionid: sessionCookie?.profile || null,
            tt_target_idc: targetIdcCookie?.profile || null
        }
    };
}

module.exports = {
    syncTikTokEnvFromChrome
};
