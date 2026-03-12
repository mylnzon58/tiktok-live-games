const { DEFAULT_COUNTRIES } = require("./constants");

function createRankingManager() {
    let countries = initCountries();
    let rankingChampion = null;

    function initCountries() {
        const c = JSON.parse(JSON.stringify(DEFAULT_COUNTRIES));
        for (const code in c) {
            c[code].avatars = [];
            c[code].donors = 0;
            c[code].likesAccumulated = 0;
            c[code].giftDiamonds = 0;
            c[code].lastGiftAt = 0;
        }
        return c;
    }

    return {
        getCountries: () => countries,
        getRankingChampion: () => rankingChampion,
        setRankingChampion: (val) => { rankingChampion = val; },

        reset: () => {
            countries = initCountries();
        },

        addPoints: (countryCode, pointsGained) => {
            if (!countries[countryCode]) return;
            countries[countryCode].score += pointsGained;
            countries[countryCode].donors++;
            countries[countryCode].giftDiamonds += pointsGained;
            countries[countryCode].lastGiftAt = Date.now();
        },

        addLikes: (countryCode, likeCount, LIKES_PER_POINT) => {
            if (!countries[countryCode]) return;
            countries[countryCode].likesAccumulated += likeCount;
            if (countries[countryCode].likesAccumulated >= LIKES_PER_POINT) {
                const pointsToAdd = Math.floor(countries[countryCode].likesAccumulated / LIKES_PER_POINT);
                countries[countryCode].score += pointsToAdd;
                countries[countryCode].likesAccumulated %= LIKES_PER_POINT;
                return true; // Indicates update needed
            }
            return false;
        },

        addAvatar: (countryCode, avatarUrl) => {
            if (!countries[countryCode]) return;
            if (avatarUrl && countries[countryCode].avatars.length < 5) {
                if (!countries[countryCode].avatars.includes(avatarUrl)) {
                    countries[countryCode].avatars.push(avatarUrl);
                }
            }
        },

        getWinner: () => {
            const sorted = Object.entries(countries)
                .filter(([, v]) => v.score > 0)
                .sort((a, b) =>
                    (b[1].score - a[1].score) ||
                    (b[1].giftDiamonds - a[1].giftDiamonds) ||
                    (b[1].donors - a[1].donors)
                );
            return sorted.length > 0 ? { code: sorted[0][0], ...sorted[0][1] } : null;
        }
    };
}

module.exports = { createRankingManager };
