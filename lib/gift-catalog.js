const fs = require("fs");
const path = require("path");

const DEFAULT_CATALOG = {
    Rose: {
        aliases: ["rosa", "rose"],
        tier: "small",
        category: "projectile",
        rarity: "common",
        scoreScale: 1,
        damageScale: 18,
        heal: 0,
        sizeScale: 0.15,
        knockback: 0.4,
        fx: "roseVolley",
        sfx: "roseShot",
        label: "Disparo rapido"
    },
    "Ice Cream": {
        aliases: ["ice cream", "helado"],
        tier: "small",
        category: "projectile",
        rarity: "common",
        scoreScale: 1,
        damageScale: 20,
        sizeScale: 0.18,
        knockback: 0.5,
        fx: "iceShot",
        sfx: "roseShot",
        label: "Disparo helado"
    },
    Perfume: {
        aliases: ["perfume"],
        tier: "medium",
        category: "shockwave",
        rarity: "uncommon",
        scoreScale: 1,
        damageScale: 24,
        sizeScale: 0.25,
        knockback: 0.8,
        fx: "shockwave",
        sfx: "hit",
        label: "Shock aromatico"
    },
    Donut: {
        aliases: ["donut", "dona"],
        tier: "medium",
        category: "shockwave",
        rarity: "uncommon",
        scoreScale: 1,
        damageScale: 26,
        sizeScale: 0.28,
        knockback: 0.9,
        fx: "shockwave",
        sfx: "hit",
        label: "Impacto circular"
    },
    Fireworks: {
        aliases: ["fireworks", "fuegos artificiales"],
        tier: "large",
        category: "fire",
        rarity: "rare",
        scoreScale: 1,
        damageScale: 30,
        sizeScale: 0.35,
        knockback: 1.2,
        fx: "fireBurst",
        sfx: "fire",
        label: "Anillo de fuego"
    },
    "Dragon Flame": {
        aliases: ["dragon flame", "dragon", "llama dragon"],
        tier: "legendary",
        category: "fire",
        rarity: "legendary",
        scoreScale: 1.08,
        damageScale: 34,
        sizeScale: 0.5,
        knockback: 1.6,
        fx: "fireStorm",
        sfx: "heavyExplosion",
        label: "Fuego legendario"
    },
    Galaxy: {
        aliases: ["galaxy", "galaxia"],
        tier: "epic",
        category: "lightning",
        rarity: "epic",
        scoreScale: 1.02,
        damageScale: 34,
        sizeScale: 0.4,
        knockback: 1.4,
        fx: "tripleLightning",
        sfx: "lightning",
        label: "Triple rayo"
    },
    Planet: {
        aliases: ["planet", "planeta"],
        tier: "legendary",
        category: "lightning",
        rarity: "legendary",
        scoreScale: 1.05,
        damageScale: 36,
        sizeScale: 0.45,
        knockback: 1.5,
        fx: "orbitalStrike",
        sfx: "lightning",
        label: "Golpe orbital"
    },
    Lion: {
        aliases: ["lion", "leon", "león"],
        tier: "legendary",
        category: "mega",
        rarity: "legendary",
        scoreScale: 1.08,
        damageScale: 40,
        sizeScale: 0.55,
        knockback: 1.8,
        fx: "megaBlast",
        sfx: "heavyExplosion",
        label: "Megablast"
    },
    "TikTok Universe": {
        aliases: ["tiktok universe", "universe", "universo"],
        tier: "legendary",
        category: "mega",
        rarity: "mythic",
        scoreScale: 1.1,
        damageScale: 44,
        sizeScale: 0.6,
        knockback: 2,
        fx: "megaBlast",
        sfx: "heavyExplosion",
        label: "Megablast premium"
    }
};

const TIER_DEFAULTS = [
    { max: 1, tier: "free", category: "tap", rarity: "common", scoreScale: 1, damageScale: 10, sizeScale: 0.08, knockback: 0.2, fx: "tapSpark", sfx: "hit", label: "Tap" },
    { max: 20, tier: "small", category: "projectile", rarity: "common", scoreScale: 1, damageScale: 18, sizeScale: 0.14, knockback: 0.4, fx: "projectile", sfx: "roseShot", label: "Disparo" },
    { max: 299, tier: "medium", category: "shockwave", rarity: "uncommon", scoreScale: 1, damageScale: 24, sizeScale: 0.22, knockback: 0.8, fx: "shockwave", sfx: "hit", label: "Impacto" },
    { max: 999, tier: "large", category: "fire", rarity: "rare", scoreScale: 1, damageScale: 28, sizeScale: 0.3, knockback: 1.1, fx: "fireBurst", sfx: "fire", label: "Estallido" },
    { max: 9999, tier: "epic", category: "lightning", rarity: "epic", scoreScale: 1.02, damageScale: 34, sizeScale: 0.4, knockback: 1.4, fx: "lightning", sfx: "lightning", label: "Rayo" },
    { max: Infinity, tier: "legendary", category: "mega", rarity: "legendary", scoreScale: 1.08, damageScale: 40, sizeScale: 0.55, knockback: 1.8, fx: "megaBlast", sfx: "heavyExplosion", label: "Megablast" }
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
        console.error("❌ Error loading gift-catalog.json:", error.message);
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
