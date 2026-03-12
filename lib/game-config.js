const GAME_CONFIG = {
    countries: {
        roundDurationSeconds: 7 * 60,
        bigGiftThreshold: 1000,
        likesPerPoint: 1,
        rankingChampionWindowMs: 12 * 60 * 60 * 1000
    },
    arena: {
        maxHp: 1000,
        suddenDeathStartsAtSeconds: 60,
        comboWindowMs: 5000,
        comboMultipliers: [
            { hits: 10, multiplier: 1.5 },
            { hits: 5, multiplier: 1.25 },
            { hits: 3, multiplier: 1.1 }
        ],
        likeHealPerTap: 2,
        likeChargeWindow: 25,
        chatBoostScore: 0,
        chatWakeKeyword: "YO",
        chatPowerKeyword: "PODER",
        respawnCooldownMs: 4000,
        respawnShieldMs: 2200,
        idleVisualAfterMs: 90 * 1000,
        removeInactiveAfterMs: 8 * 60 * 1000,
        removeChampionAfterMs: 15 * 60 * 1000,
        hallOfFameWindowMs: 12 * 60 * 60 * 1000,
        arenaBroadcastDelayMs: 33,
        centerBonusLabel: "ZONA REY"
    }
};

module.exports = {
    GAME_CONFIG
};
