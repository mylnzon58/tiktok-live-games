const GAME_CONFIG = {
    countries: {
        roundDurationSeconds: 5 * 60,
        bigGiftThreshold: 1000,
        likesPerPoint: 1,
        rankingChampionWindowMs: 12 * 60 * 60 * 1000
    },
    arena: {
        roundDurationSeconds: 3 * 60,
        maxHp: 1000,
        suddenDeathStartsAtSeconds: 45,
        suddenDeathDamageMultiplier: 3,
        suddenDeathScoreMultiplier: 2.5,
        suddenDeathLikeStrikeMultiplier: 2.2,
        comboWindowMs: 5000,
        comboMultipliers: [
            { hits: 10, multiplier: 1.5 },
            { hits: 5, multiplier: 1.25 },
            { hits: 3, multiplier: 1.1 }
        ],
        likeHealPerTap: 2,
        likeScorePerTap: 3,
        likeChargeWindow: 25,
        likeComboWindowMs: 2500,
        likeBurstThreshold: 16,
        likeMiniPowerThreshold: 30,
        likeMegaPowerThreshold: 80,
        likeMiniPowerDurationFrames: 360,
        likeMegaPowerDurationFrames: 620,
        likeStrikeThreshold: 8,
        likeStrikeDamagePerTap: 3,
        likeStrikeMaxDamage: 90,
        sawTickIntervalMs: 220,
        sawAuraBonusRadius: 28,
        sawDamagePerTick: 14,
        passiveSawSmallScore: 400,
        passiveSawContinuousScore: 550,
        passiveSawMediumScore: 700,
        passiveSawLargeScore: 1000,
        damageScoreLossRatio: 0.22,
        minimumDamageScoreLoss: 1,
        koScoreLossBonus: 20,
        koScoreRetainRatio: 0.35,
        roundHpWeight: 0.45,
        roundDeathPenalty: 180,
        aliveStandingFloorRatio: 0.22,
        chatPowerScoreBoost: 8,
        chatPowerHeal: 80,
        chatPowerDurationFrames: 150,
        chatBoostScore: 0,
        chatWakeKeyword: "YO",
        chatPowerKeyword: "PODER",
        respawnCooldownMs: 100,
        respawnShieldMs: 1500,
        idleVisualAfterMs: 60 * 1000,
        removeInactiveAfterMs: 5 * 60 * 1000,
        removeChampionAfterMs: 15 * 60 * 1000,
        hallOfFameWindowMs: 12 * 60 * 60 * 1000,
        championMemoryWindowMs: 12 * 60 * 60 * 1000,
        arenaBroadcastDelayMs: 10, // Reducido para optimizar performance y evitar lag
        centerBonusLabel: "ZONA REY",
        circleRadius: 350, // Ajustado a 350 para que quepa perfecto en 800x1350
        beginnerLikeScorePerTap: 12, // Taps iniciales más fuertes
        catchUpMultiplier: 2.5, // Mayor multiplicador
        catchUpScoreThreshold: 800 // Beneficio dura hasta los 800 puntos
    }
};

module.exports = {
    GAME_CONFIG
};
