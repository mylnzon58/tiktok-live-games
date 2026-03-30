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
        likeHealPerTap: 4, // Aumentado de 2 a 4 para mejor supervivencia
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
        chatPowerHeal: 120, // Aumentado de 80 a 120
        chatPowerDurationFrames: 150,
        chatBoostScore: 0,
        chatWakeKeyword: "YO",
        chatPowerKeyword: "PODER",
        respawnCooldownMs: 100,
        respawnShieldMs: 8000, // Aumentado de 1500 a 8000
        initialResilienceDurationMs: 120000, // 2 minutos de protección inicial
        resilienceThresholdScore: 1500, // Protección hasta los 1500 puntos
        underdogDamageTakenRatio: 0.35, // Solo recibe 35% del daño
        respawnResilienceMs: 30000, // 30 segundos de resistencia tras revivir
        idleVisualAfterMs: 3 * 60 * 1000, // Visual idle tras 3 min
        removeInactiveAfterMs: 20 * 60 * 1000, // Se remueven a los 20 minutos (evita que desaparezcan de la nada)
        removeChampionAfterMs: 30 * 60 * 1000,
        hallOfFameWindowMs: 12 * 60 * 60 * 1000,
        championMemoryWindowMs: 12 * 60 * 60 * 1000,
        arenaBroadcastDelayMs: 30, // Optimizado al máximo (30ms) para que sea instantáneo
        centerBonusLabel: "ZONA REY",
        circleRadius: 350,
        beginnerLikeScorePerTap: 12,
        catchUpMultiplier: 2.8, // Aumentado de 2.8 para rampa de inicio rápida
        catchUpScoreThreshold: 1500, // Beneficio dura hasta los 1500 puntos (era 1000)
        underdogMaxDamageCap: 250, // Un novato nunca recibe más de 250 de daño de un solo golpe (garantiza sobrevivir al menos 4-5 tap/gifts pequeños)
        davidVsGoliathMultiplier: 2.5, // Si un pequeño ataca a un gigante, pega 2.5x más duro
        davidVsGoliathScoreBonus: 2.0, // Gana el doble de puntos por el atrevimiento
        bullySizeRatioThreshold: 5 // Relación de poder (5x) para que se aplique la reducción de daño de Bullying
    }
};

module.exports = {
    GAME_CONFIG
};
