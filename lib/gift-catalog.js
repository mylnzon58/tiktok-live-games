const fs = require("fs");
const path = require("path");

const DEFAULT_CATALOG = {
    Rose: {
        aliases: ["rosa", "rose"],
        tier: "small",
        category: "projectile",
        rarity: "common",
        scoreScale: 0.95,
        damageScale: 20,
        heal: 0,
        sizeScale: 0.35,
        knockback: 0.35,
        fx: "roseVolley",
        sfx: "roseShot",
        label: "¡Ráfaga de Rosas!"
    },
    "Ice Cream": {
        aliases: ["ice cream", "helado"],
        tier: "small",
        category: "projectile",
        rarity: "common",
        scoreScale: 1.05,
        damageScale: 24,
        sizeScale: 0.22,
        knockback: 0.38,
        fx: "iceShot",
        sfx: "roseShot",
        label: "Disparo helado"
    },
    Capybara: {
        aliases: ["capybara", "capibara"],
        tier: "medium",
        category: "shockwave",
        rarity: "uncommon",
        scoreScale: 2.15,
        damageScale: 52,
        sizeScale: 0.42,
        knockback: 0.82,
        fx: "shockwave",
        sfx: "heavyExplosion",
        label: "Choque de capibara"
    },
    Perfume: {
        aliases: ["perfume"],
        tier: "medium",
        category: "shockwave",
        rarity: "uncommon",
        scoreScale: 1.95,
        damageScale: 46,
        sizeScale: 0.4,
        knockback: 0.78,
        fx: "shockwave",
        sfx: "hit",
        label: "Shock aromatico"
    },
    Donut: {
        aliases: ["donut", "dona"],
        tier: "medium",
        category: "shockwave",
        rarity: "uncommon",
        scoreScale: 2.35,
        damageScale: 58,
        sizeScale: 0.62,
        knockback: 0.86,
        fx: "shockwave",
        sfx: "hit",
        label: "Impacto circular"
    },
    Fireworks: {
        aliases: ["fireworks", "fuegos artificiales"],
        tier: "large",
        category: "fire",
        rarity: "rare",
        scoreScale: 2.8,
        damageScale: 66,
        sizeScale: 0.5,
        knockback: 0.95,
        fx: "fireBurst",
        sfx: "fire",
        label: "Anillo de fuego"
    },
    "Dragon Flame": {
        aliases: ["dragon flame", "dragon", "llama dragon"],
        tier: "legendary",
        category: "fire",
        rarity: "legendary",
        scoreScale: 6.6,
        damageScale: 180,
        sizeScale: 0.78,
        knockback: 1.12,
        fx: "fireStorm",
        sfx: "heavyExplosion",
        label: "¡FUEGO DRACÓNICO!"
    },
    Galaxy: {
        aliases: ["galaxy", "galaxia"],
        tier: "epic",
        category: "lightning",
        rarity: "epic",
        scoreScale: 4.8,
        damageScale: 120,
        sizeScale: 0.64,
        knockback: 1.05,
        fx: "tripleLightning",
        sfx: "lightning",
        label: "¡SENTENCIA GALÁCTICA!"
    },
    Planet: {
        aliases: ["planet", "planeta"],
        tier: "legendary",
        category: "lightning",
        rarity: "legendary",
        scoreScale: 5.6,
        damageScale: 145,
        sizeScale: 0.7,
        knockback: 1.08,
        fx: "orbitalStrike",
        sfx: "lightning",
        label: "¡ANIQUILACIÓN ORBITAL!"
    },
    Lion: {
        aliases: ["lion", "leon", "león"],
        tier: "legendary",
        category: "mega",
        rarity: "legendary",
        scoreScale: 45.0,
        damageScale: 1200,
        sizeScale: 1.4,
        knockback: 2.2,
        fx: "megaBlast",
        sfx: "lionRoar",
        label: "¡RUGIDO DEL REY LEÓN!"
    },
    "TikTok Universe": {
        aliases: ["tiktok universe", "universe", "universo"],
        tier: "legendary",
        category: "mega",
        rarity: "mythic",
        scoreScale: 120.0,
        damageScale: 3500,
        sizeScale: 2.0,
        knockback: 3.5,
        fx: "megaBlast",
        sfx: "universeCrash",
        label: "¡COLAPSO UNIVERSAL!"
    }
};

const TIER_DEFAULTS = [
    { max: 1, tier: "free", category: "tap", rarity: "common", scoreScale: 0.3, damageScale: 6, sizeScale: 0.1, knockback: 0.12, fx: "tapSpark", sfx: "hit", label: "Tap" },
    { max: 20, tier: "small", category: "projectile", rarity: "common", scoreScale: 0.65, damageScale: 14, sizeScale: 0.2, knockback: 0.22, fx: "projectile", sfx: "roseShot", label: "Disparo" },
    { max: 299, tier: "medium", category: "shockwave", rarity: "uncommon", scoreScale: 1.55, damageScale: 36, sizeScale: 0.4, knockback: 0.6, fx: "shockwave", sfx: "hit", label: "Impacto" },
    { max: 999, tier: "large", category: "fire", rarity: "rare", scoreScale: 2.9, damageScale: 72, sizeScale: 0.7, knockback: 0.85, fx: "fireBurst", sfx: "fire", label: "Estallido" },
    { max: 9999, tier: "epic", category: "lightning", rarity: "epic", scoreScale: 12.0, damageScale: 350, sizeScale: 1.2, knockback: 1.2, fx: "lightning", sfx: "lightning", label: "Rayo" },
    { max: Infinity, tier: "legendary", category: "mega", rarity: "mythic", scoreScale: 60.0, damageScale: 1500, sizeScale: 2.2, knockback: 2.5, fx: "megaBlast", sfx: "heavyExplosion", label: "Megablast" }
];

function loadExternalCatalog() {
    const filePath = path.join(__dirname, "..", "gift-catalog.json");
    if (!fs.existsSync(filePath)) {
        return DEFAULT_CATALOG;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return { ...DEFAULT_CATALOG, ...parsed };
    } catch (error) {
        console.error("Error al cargar gift-catalog.json:", error.message);
        return DEFAULT_CATALOG;
    }
}

function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
}

function findTierDefaults(diamondCount) {
    return TIER_DEFAULTS.find((entry) => diamondCount <= entry.max) || TIER_DEFAULTS[TIER_DEFAULTS.length - 1];
}

function createGiftCatalog() {
    const catalog = loadExternalCatalog();
    const aliasMap = new Map();

    Object.entries(catalog).forEach(([name, entry]) => {
        aliasMap.set(normalizeName(name), name);
        (entry.aliases || []).forEach((alias) => aliasMap.set(normalizeName(alias), name));
    });

    function resolveGift(rawGift = {}) {
        const diamondCount = Math.max(
            Number(rawGift.diamondCount ?? rawGift.gift?.diamond_count ?? rawGift.gift?.diamondCount ?? 0) || 0,
            1
        );
        const repeatCount = Math.max(Number(rawGift.repeatCount ?? rawGift.count ?? 1) || 1, 1);
        const rawName = rawGift.giftName || rawGift.gift?.gift_name || rawGift.gift?.name || "Unknown Gift";
        const resolvedKey = aliasMap.get(normalizeName(rawName));
        const tierDefaults = findTierDefaults(diamondCount);
        const definition = resolvedKey ? catalog[resolvedKey] : null;
        const merged = { ...tierDefaults, ...(definition || {}) };

        return {
            key: resolvedKey || rawName,
            matchedByCatalog: Boolean(resolvedKey),
            tierFallbackUsed: !resolvedKey,
            id: rawGift.giftId || rawGift.gift?.gift_id || null,
            name: rawName,
            diamondCount,
            repeatCount,
            totalDiamonds: diamondCount * repeatCount,
            tier: merged.tier,
            category: merged.category,
            rarity: merged.rarity,
            scoreScale: merged.scoreScale,
            damageScale: merged.damageScale,
            heal: merged.heal || 0,
            sizeScale: merged.sizeScale,
            knockback: merged.knockback,
            fx: merged.fx,
            sfx: merged.sfx,
            label: merged.label
        };
    }

    function getCatalogSnapshot() {
        return Object.entries(catalog).map(([name, entry]) => ({ name, ...entry }));
    }

    return {
        resolveGift,
        getCatalogSnapshot
    };
}

module.exports = {
    createGiftCatalog
};
