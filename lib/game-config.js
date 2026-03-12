const GAME_CONFIG = {
    countries: {
        roundDurationSeconds: 5 * 60,
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
        likeScorePerTap: 0.75,
        likeChargeWindow: 25,
        likeComboWindowMs: 2500,
        likeBurstThreshold: 25,
        likeMiniPowerThreshold: 60,
        likeMegaPowerThreshold: 150,
        likeMiniPowerDurationFrames: 260,
        likeMegaPowerDurationFrames: 480,
        likeStrikeThreshold: 12,
        likeStrikeDamagePerTap: 3,
        likeStrikeMaxDamage: 90,
        damageScoreLossRatio: 0.22,
        minimumDamageScoreLoss: 1,
        koScoreLossBonus: 20,
        roundHpWeight: 0.45,
        roundDeathPenalty: 180,
        chatPowerScoreBoost: 8,
        chatPowerHeal: 80,
        chatPowerDurationFrames: 150,
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
