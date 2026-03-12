function normalizeUser(raw = {}) {
    const user = raw.user || raw;
    const id = user.uniqueId || raw.uniqueId || user.userId || raw.userId || null;
    if (!id) return null;

    return {
        id,
        uniqueId: id,
        nickname: user.nickname || raw.nickname || id,
        profilePictureUrl: user.profilePictureUrl || raw.profilePictureUrl || "",
        countryCode: user.countryCode || raw.countryCode || raw.user?.countryCode || "",
        raw
    };
}

function normalizeGiftEvent(raw = {}, giftCatalog) {
    const user = normalizeUser(raw);
    const gift = giftCatalog.resolveGift(raw);

    return {
        user,
        gift,
        uniqueId: user?.id || raw.uniqueId || null,
        nickname: user?.nickname || raw.nickname || "",
        profilePictureUrl: user?.profilePictureUrl || raw.profilePictureUrl || "",
        raw
    };
}

function normalizeLikeEvent(raw = {}) {
    const user = normalizeUser(raw);
    return {
        user,
        likeCount: Math.max(Number(raw.likeCount || raw.count || 1) || 1, 1),
        uniqueId: user?.id || raw.uniqueId || null,
        raw
    };
}

function normalizeChatEvent(raw = {}) {
    const user = normalizeUser(raw);
    return {
        user,
        comment: String(raw.comment || "").trim(),
        uniqueId: user?.id || raw.uniqueId || null,
        raw
    };
}

module.exports = {
    normalizeUser,
    normalizeGiftEvent,
    normalizeLikeEvent,
    normalizeChatEvent
};
