// ==========================================
// COUNTRIES MANAGER — Batalla de Países (/overlay)
// Estado autoritativo del ranking por países.
// Responsable: servidor. El overlay es solo presentación.
// ==========================================

const { createStorage } = require("./storage");

const COUNTRIES_CONFIG = {
    roundDurationMs: 7 * 60 * 1000,
    bigGiftThreshold: 1000,
    maxAvatarsPerCountry: 5
};

const COUNTRY_NAMES = {
    // Latinoamérica y Caribe
    AR: "Argentina", MX: "México", BR: "Brasil", CO: "Colombia", VE: "Venezuela",
    PE: "Perú", CL: "Chile", EC: "Ecuador", BO: "Bolivia", PY: "Paraguay",
    UY: "Uruguay", GT: "Guatemala", HN: "Honduras", NI: "Nicaragua", CR: "Costa Rica",
    SV: "El Salvador", PA: "Panamá", CU: "Cuba", DO: "Rep. Dominicana", PR: "Puerto Rico",
    HT: "Haití", JM: "Jamaica", TT: "Trinidad y Tobago", BZ: "Belice", GY: "Guyana",
    SR: "Surinam",
    // Norteamérica
    US: "EE.UU.", CA: "Canadá",
    // Europa
    ES: "España", GB: "Reino Unido", DE: "Alemania", FR: "Francia", IT: "Italia",
    PT: "Portugal", NL: "Países Bajos", BE: "Bélgica", CH: "Suiza", AT: "Austria",
    SE: "Suecia", NO: "Noruega", DK: "Dinamarca", FI: "Finlandia", IE: "Irlanda",
    PL: "Polonia", CZ: "Chequia", RO: "Rumania", HU: "Hungría", GR: "Grecia",
    HR: "Croacia", BG: "Bulgaria", RS: "Serbia", SK: "Eslovaquia", SI: "Eslovenia",
    UA: "Ucrania", RU: "Rusia", TR: "Turquía", IS: "Islandia", LT: "Lituania",
    LV: "Letonia", EE: "Estonia", AL: "Albania", BA: "Bosnia", MK: "Macedonia del Norte",
    ME: "Montenegro", LU: "Luxemburgo", MT: "Malta", CY: "Chipre", MD: "Moldavia",
    BY: "Bielorrusia",
    // Asia y Medio Oriente
    IL: "Israel", JP: "Japón", KR: "Corea del Sur", CN: "China", IN: "India",
    TH: "Tailandia", VN: "Vietnam", PH: "Filipinas", ID: "Indonesia", MY: "Malasia",
    SG: "Singapur", PK: "Pakistán", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal",
    MM: "Myanmar", KH: "Camboya", LA: "Laos", TW: "Taiwán", HK: "Hong Kong",
    AE: "Emiratos Árabes", SA: "Arabia Saudita", QA: "Catar", KW: "Kuwait",
    IQ: "Iraq", IR: "Irán", JO: "Jordania", LB: "Líbano", GE: "Georgia",
    AM: "Armenia", AZ: "Azerbaiyán", UZ: "Uzbekistán", KZ: "Kazajistán", MN: "Mongolia"
};

function countryCodeToFlag(code) {
    if (!code || code.length !== 2) return "🏳️";
    const upper = code.toUpperCase();
    return String.fromCodePoint(
        ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
    );
}

function normalizeText(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function createCountriesManager(io) {
    const championStorage = createStorage("countries_champion.json", null);
    let champion = championStorage.load();

    let countries = {};
    let allegiance = {}; // userId -> countryCode
    let currentLeader = null;
    let roundTimer = null;

    function initCountries() {
        countries = {};
        for (const code of Object.keys(COUNTRY_NAMES)) {
            countries[code] = {
                code,
                score: 0,
                flag: countryCodeToFlag(code),
                name: COUNTRY_NAMES[code],
                avatars: [],
                donors: 0
            };
        }
    }

    function sortedCountries() {
        return Object.entries(countries)
            .filter(([, v]) => v.score > 0)
            .sort((a, b) => b[1].score - a[1].score);
    }

    function checkLeaderChange() {
        const sorted = sortedCountries();
        if (sorted.length === 0) return;
        const [code, data] = sorted[0];
        if (code !== currentLeader) {
            currentLeader = code;
            io.emit("leaderChanged", {
                code,
                flag: data.flag,
                name: data.name,
                score: data.score
            });
        }
    }

    function resolveCountry(user, fallbackCode) {
        const direct = String(user?.countryCode || "").toUpperCase();
        if (COUNTRY_NAMES[direct]) return direct;
        if (fallbackCode && COUNTRY_NAMES[fallbackCode]) return fallbackCode;
        return null;
    }

    function addScore(code, value, event, repeatCount) {
        if (!countries[code]) {
            countries[code] = {
                code,
                score: 0,
                flag: countryCodeToFlag(code),
                name: COUNTRY_NAMES[code] || code,
                avatars: [],
                donors: 0
            };
        }
        countries[code].score += value;
        countries[code].donors += 1;

        const avatarUrl = event?.profilePictureUrl || event?.user?.profilePictureUrl || "";
        const avatars = countries[code].avatars;
        if (avatarUrl && avatars.length < COUNTRIES_CONFIG.maxAvatarsPerCountry && !avatars.includes(avatarUrl)) {
            avatars.push(avatarUrl);
        }

        io.emit("ranking:gift", {
            country: code,
            avatarUrl,
            giftName: event?.gift?.name || "Regalo",
            coins: value,
            repeatCount: repeatCount || 1
        });
        io.emit("rankingUpdate", countries);
        checkLeaderChange();

        if (value >= COUNTRIES_CONFIG.bigGiftThreshold) {
            io.emit("bigGift", {
                country: code,
                flag: countries[code].flag,
                coins: value,
                giftName: event?.gift?.name || "Regalo",
                username: event?.nickname || event?.user?.nickname || "?",
                avatarUrl
            });
        }
    }

    function resetRound() {
        const sorted = sortedCountries();
        const winner = sorted.length > 0 ? { code: sorted[0][0], ...sorted[0][1] } : null;

        if (winner) {
            champion = {
                name: winner.name,
                flag: winner.flag,
                country: winner.code,
                avatar: winner.avatars?.[0] || ""
            };
            championStorage.save(champion);
            io.emit("ranking:championUpdate", champion);
        }

        initCountries();
        currentLeader = null;
        io.emit("roundReset", { winner, countries });
        io.emit("rankingUpdate", countries);
        startRound();
    }

    function startRound() {
        clearInterval(roundTimer);
        roundTimer = setInterval(() => {
            resetRound();
        }, COUNTRIES_CONFIG.roundDurationMs);
    }

    initCountries();

    return {
        syncClient(socket) {
            socket.emit("rankingUpdate", countries);
            socket.emit("ranking:championUpdate", champion);
        },

        handleCountriesGift(event) {
            if (!event?.user?.id) return;
            const uid = event.user.id;
            const diamonds = event.gift?.totalDiamonds || event.gift?.diamondCount || 1;
            const repeat = event.gift?.repeatCount || 1;
            const value = Math.max(1, Math.round(diamonds * repeat));

            const country = resolveCountry(event.user, allegiance[uid]);
            if (!country) {
                console.warn(`[countries] regalo sin país válido de @${event.user.id}`);
                return;
            }
            allegiance[uid] = country;
            addScore(country, value, event, repeat);
        },

        handleCountriesLike(event) {
            if (!event?.user?.id) return;
            const country = resolveCountry(event.user, allegiance[event.user.id]);
            if (!country) return;
            allegiance[event.user.id] = country;
            io.emit("ranking:like", {
                country,
                likeCount: event.likeCount || 1
            });
        },

        handleCountriesChat(event) {
            if (!event?.user?.id) return;
            const comment = normalizeText(event.comment || "");
            if (!comment) return;

            let match = null;
            for (const code of Object.keys(COUNTRY_NAMES)) {
                const nameKey = normalizeText(COUNTRY_NAMES[code]);
                if (comment === code.toLowerCase() || comment.includes(nameKey)) {
                    match = code;
                    break;
                }
            }
            if (!match) return;

            allegiance[event.user.id] = match;
            io.emit("ranking:countryJoined", {
                flag: countries[match].flag,
                userId: event.user.id,
                country: countries[match].name
            });
        },

        start() {
            startRound();
        }
    };
}

module.exports = createCountriesManager;
