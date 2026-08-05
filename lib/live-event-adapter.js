// ==========================================
// NORMALIZADOR DE EVENTOS TIKTOK LIVE
// Optimizado: limpieza periódica de Maps, sin retención de raw data
// ==========================================

const giftStreakState = new Map();
const likeState = new Map();

// Limpieza periódica de Maps acumulativos (cada 60 segundos)
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_STREAK_AGE_MS = 30_000;  // Los streaks de más de 30 segundos se purgan
const MAX_LIKE_ENTRIES = 2000;     // Máximo 2000 usuarios en likeState

setInterval(() => {
    const now = Date.now();

    // Purga streaks viejos (si un streak no terminó en 30 s, está obsoleto)
    for (const [key, entry] of giftStreakState) {
        if (typeof entry === "object" && entry.ts && now - entry.ts > MAX_STREAK_AGE_MS) {
            giftStreakState.delete(key);
        }
    }

    // Purgar likeState si supera el límite
    if (likeState.size > MAX_LIKE_ENTRIES) {
        const keys = [...likeState.keys()];
        const toDelete = keys.slice(0, keys.length - MAX_LIKE_ENTRIES);
        toDelete.forEach(k => likeState.delete(k));
    }
}, CLEANUP_INTERVAL_MS);

function normalizeUser(raw = {}) {
    const user = raw.user || raw;
    const id = user.uniqueId || raw.uniqueId || user.userId || raw.userId || null;
    if (!id) return null;

    return {
        id,
        uniqueId: id,
        nickname: user.nickname || raw.nickname || id,
        profilePictureUrl: user.profilePictureUrl || raw.profilePictureUrl || "",
        countryCode: user.countryCode || raw.countryCode || raw.user?.countryCode || ""
    };
}

function toPositiveNumber(...values) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return 0;
}

function normalizeGiftFields(raw = {}) {
    const diamondCount = toPositiveNumber(
        raw.diamondCount,
        raw.gift?.diamond_count,
        raw.gift?.diamondCount,
        raw.extendedGiftInfo?.diamond_count,
        raw.extendedGiftInfo?.diamondCount,
        raw.extendedGiftInfo?.diamondCountList?.[0]?.diamondCount,
        raw.totalDiamondCount
    ) || 1;

    const repeatCount = toPositiveNumber(
        raw.repeatCount,
        raw.comboCount,
        raw.gift?.repeat_count,
        raw.gift?.repeatCount,
        raw.count
    ) || 1;

    const totalDiamondCount = toPositiveNumber(
        raw.totalDiamondCount,
        raw.gift?.totalDiamondCount,
        raw.gift?.total_diamond_count
    );

    const giftType = Number(raw.giftType ?? raw.gift?.gift_type ?? raw.extendedGiftInfo?.giftType ?? 0) || 0;
    const repeatEnd = Boolean(raw.repeatEnd ?? raw.gift?.repeat_end);
    const giftId = raw.giftId || raw.gift?.gift_id || raw.gift?.giftId || raw.extendedGiftInfo?.id || null;

    return {
        diamondCount,
        repeatCount,
        totalDiamondCount,
        giftType,
        repeatEnd,
        giftId
    };
}

function normalizeGiftEvent(raw = {}, giftCatalog) {
    const user = normalizeUser(raw);
    if (!user) return null;

    const fields = normalizeGiftFields(raw);
    const giftName = raw.giftName || raw.gift?.gift_name || raw.gift?.name || "unknown";
    const streakKey = `${user.id}:${fields.giftId || giftName}`;
    let effectiveRepeatCount = fields.repeatCount;
    let repeatCountSource = fields.repeatCount > 0 ? "direct" : "fallback";

    if (fields.giftType === 1) {
        const streakEntry = giftStreakState.get(streakKey);
        const previousRepeatCount = (streakEntry && typeof streakEntry === "object") ? streakEntry.count : (streakEntry || 0);
        effectiveRepeatCount = Math.max(fields.repeatCount - previousRepeatCount, 0);

        if (fields.repeatEnd) {
            giftStreakState.delete(streakKey);
        } else {
            // Se guarda el timestamp para poder purgar streaks obsoletos
            giftStreakState.set(streakKey, { count: fields.repeatCount, ts: Date.now() });
        }
    }

    if (fields.totalDiamondCount > 0 && fields.diamondCount > 0) {
        const totalBasedRepeatCount = Math.max(1, Math.round(fields.totalDiamondCount / fields.diamondCount));
        if (fields.giftType !== 1) {
            effectiveRepeatCount = totalBasedRepeatCount;
            repeatCountSource = "derived_total";
        } else if (effectiveRepeatCount <= 0) {
            const streakEntry = giftStreakState.get(streakKey);
            const previousRepeatCount = fields.repeatEnd ? 0 : ((streakEntry && typeof streakEntry === "object") ? streakEntry.count : 0);
            effectiveRepeatCount = Math.max(totalBasedRepeatCount - previousRepeatCount, 0);
            repeatCountSource = "derived_total";
        }
    }

    if (effectiveRepeatCount <= 0) {
        return null;
    }

    const gift = giftCatalog.resolveGift({
        ...raw,
        diamondCount: fields.diamondCount,
        repeatCount: effectiveRepeatCount,
        giftType: fields.giftType,
        repeatEnd: fields.repeatEnd,
        giftId: fields.giftId
    });

    return {
        user,
        gift,
        repeatCountSource,
        uniqueId: user.id,
        nickname: user.nickname,
        profilePictureUrl: user.profilePictureUrl
    };
}

function normalizeLikeEvent(raw = {}) {
    const user = normalizeUser(raw);
    if (!user) return null;

    const totalLikeCount = toPositiveNumber(raw.totalLikeCount, raw.totalCount);
    let likeCount = toPositiveNumber(raw.likeCount, raw.count);
    let countSource = likeCount > 0 ? "direct" : "fallback";

    if (!likeCount && totalLikeCount) {
        const previousTotal = likeState.get(user.id) || 0;
        likeCount = Math.max(totalLikeCount - previousTotal, 0);
        countSource = "derived_total";
    }

    if (!likeCount) {
        likeCount = 1;
        countSource = "fallback_one";
    }

    if (totalLikeCount) {
        likeState.set(user.id, totalLikeCount);
    }

    return {
        user,
        likeCount: Math.max(likeCount, 1),
        totalLikeCount,
        countSource,
        uniqueId: user.id
    };
}

function normalizeChatEvent(raw = {}) {
    const user = normalizeUser(raw);
    return {
        user,
        comment: String(raw.comment || "").trim(),
        uniqueId: user?.id || null
    };
}

module.exports = {
    normalizeUser,
    normalizeGiftEvent,
    normalizeLikeEvent,
    normalizeChatEvent
};
