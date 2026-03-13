const DEFAULT_COUNTRIES = {
    AR: { score: 0, flag: "🇦🇷", name: "Argentina" },
    MX: { score: 0, flag: "🇲🇽", name: "México" },
    BR: { score: 0, flag: "🇧🇷", name: "Brasil" },
    CO: { score: 0, flag: "🇨🇴", name: "Colombia" },
    VE: { score: 0, flag: "🇻🇪", name: "Venezuela" },
    PE: { score: 0, flag: "🇵🇪", name: "Perú" },
    CL: { score: 0, flag: "🇨🇱", name: "Chile" },
    EC: { score: 0, flag: "🇪🇨", name: "Ecuador" },
    BO: { score: 0, flag: "🇧🇴", name: "Bolivia" },
    PY: { score: 0, flag: "🇵🇾", name: "Paraguay" },
    UY: { score: 0, flag: "🇺🇾", name: "Uruguay" },
    GT: { score: 0, flag: "🇬🇹", name: "Guatemala" },
    HN: { score: 0, flag: "🇭🇳", name: "Honduras" },
    NI: { score: 0, flag: "🇳🇮", name: "Nicaragua" },
    CR: { score: 0, flag: "🇨🇷", name: "Costa Rica" },
    SV: { score: 0, flag: "🇸🇻", name: "El Salvador" },
    PA: { score: 0, flag: "🇵🇦", name: "Panamá" },
    CU: { score: 0, flag: "🇨🇺", name: "Cuba" },
    DO: { score: 0, flag: "🇩🇴", name: "Rep. Dominicana" },
    PR: { score: 0, flag: "🇵🇷", name: "Puerto Rico" },
    HT: { score: 0, flag: "🇭🇹", name: "Haití" },
    JM: { score: 0, flag: "🇯🇲", name: "Jamaica" },
    TT: { score: 0, flag: "🇹🇹", name: "Trinidad y Tobago" },
    BZ: { score: 0, flag: "🇧🇿", name: "Belice" },
    GY: { score: 0, flag: "🇬🇾", name: "Guyana" },
    SR: { score: 0, flag: "🇸🇷", name: "Surinam" },
    US: { score: 0, flag: "🇺🇸", name: "Estados Unidos" },
    CA: { score: 0, flag: "🇨🇦", name: "Canadá" },
    ES: { score: 0, flag: "🇪🇸", name: "España" },
    GB: { score: 0, flag: "🇬🇧", name: "Reino Unido" },
    DE: { score: 0, flag: "🇩🇪", name: "Alemania" },
    FR: { score: 0, flag: "🇫🇷", name: "Francia" },
    IT: { score: 0, flag: "🇮🇹", name: "Italia" },
    PT: { score: 0, flag: "🇵🇹", name: "Portugal" },
    NL: { score: 0, flag: "🇳🇱", name: "Países Bajos" },
    BE: { score: 0, flag: "🇧🇪", name: "Bélgica" },
    CH: { score: 0, flag: "🇨🇭", name: "Suiza" },
    AT: { score: 0, flag: "🇦🇹", name: "Austria" },
    SE: { score: 0, flag: "🇸🇪", name: "Suecia" },
    NO: { score: 0, flag: "🇳🇴", name: "Noruega" },
    DK: { score: 0, flag: "🇩🇰", name: "Dinamarca" },
    FI: { score: 0, flag: "🇫🇮", name: "Finlandia" },
    IE: { score: 0, flag: "🇮🇪", name: "Irlanda" },
    PL: { score: 0, flag: "🇵🇱", name: "Polonia" },
    CZ: { score: 0, flag: "🇨🇿", name: "Chequia" },
    RO: { score: 0, flag: "🇷🇴", name: "Rumania" },
    HU: { score: 0, flag: "🇭🇺", name: "Hungría" },
    GR: { score: 0, flag: "🇬🇷", name: "Grecia" },
    HR: { score: 0, flag: "🇭🇷", name: "Croacia" },
    BG: { score: 0, flag: "🇧🇬", name: "Bulgaria" },
    RS: { score: 0, flag: "🇷🇸", name: "Serbia" },
    SK: { score: 0, flag: "🇸🇰", name: "Eslovaquia" },
    SI: { score: 0, flag: "🇸🇮", name: "Eslovenia" },
    UA: { score: 0, flag: "🇺🇦", name: "Ucrania" },
    RU: { score: 0, flag: "🇷🇺", name: "Rusia" },
    TR: { score: 0, flag: "🇹🇷", name: "Turquía" },
    IS: { score: 0, flag: "🇮🇸", name: "Islandia" },
    LT: { score: 0, flag: "🇱🇹", name: "Lituania" },
    LV: { score: 0, flag: "🇱🇻", name: "Letonia" },
    EE: { score: 0, flag: "🇪🇪", name: "Estonia" },
    AL: { score: 0, flag: "🇦🇱", name: "Albania" },
    BA: { score: 0, flag: "🇧🇦", name: "Bosnia" },
    MK: { score: 0, flag: "🇲🇰", name: "Macedonia del Norte" },
    ME: { score: 0, flag: "🇲🇪", name: "Montenegro" },
    LU: { score: 0, flag: "🇱🇺", name: "Luxemburgo" },
    MT: { score: 0, flag: "🇲🇹", name: "Malta" },
    CY: { score: 0, flag: "🇨🇾", name: "Chipre" },
    MD: { score: 0, flag: "🇲🇩", name: "Moldavia" },
    BY: { score: 0, flag: "🇧🇾", name: "Bielorrusia" },
    IL: { score: 0, flag: "🇮🇱", name: "Israel" },
    JP: { score: 0, flag: "🇯🇵", name: "Japón" },
    KR: { score: 0, flag: "🇰🇷", name: "Corea del Sur" },
    CN: { score: 0, flag: "🇨🇳", name: "China" },
    IN: { score: 0, flag: "🇮🇳", name: "India" },
    TH: { score: 0, flag: "🇹🇭", name: "Tailandia" },
    VN: { score: 0, flag: "🇻🇳", name: "Vietnam" },
    PH: { score: 0, flag: "🇵🇭", name: "Filipinas" },
    ID: { score: 0, flag: "🇮🇩", name: "Indonesia" },
    MY: { score: 0, flag: "🇲🇾", name: "Malasia" },
    SG: { score: 0, flag: "🇸🇬", name: "Singapur" },
    PK: { score: 0, flag: "🇵🇰", name: "Pakistán" },
    BD: { score: 0, flag: "🇧🇩", name: "Bangladesh" },
    LK: { score: 0, flag: "🇱🇰", name: "Sri Lanka" },
    NP: { score: 0, flag: "🇳🇵", name: "Nepal" },
    MM: { score: 0, flag: "🇲🇲", name: "Myanmar" },
    KH: { score: 0, flag: "🇰🇭", name: "Camboya" },
    LA: { score: 0, flag: "🇱🇦", name: "Laos" },
    TW: { score: 0, flag: "🇹🇼", name: "Taiwán" },
    HK: { score: 0, flag: "🇭🇰", name: "Hong Kong" },
    AE: { score: 0, flag: "🇦🇪", name: "Emiratos Árabes" },
    SA: { score: 0, flag: "🇸🇦", name: "Arabia Saudita" },
    QA: { score: 0, flag: "🇶🇦", name: "Catar" },
    KW: { score: 0, flag: "🇰🇼", name: "Kuwait" },
    IQ: { score: 0, flag: "🇮🇶", name: "Iraq" },
    IR: { score: 0, flag: "🇮🇷", name: "Irán" },
    JO: { score: 0, flag: "🇯🇴", name: "Jordania" },
    LB: { score: 0, flag: "🇱🇧", name: "Líbano" },
    GE: { score: 0, flag: "🇬🇪", name: "Georgia" },
    AM: { score: 0, flag: "🇦🇲", name: "Armenia" },
    AZ: { score: 0, flag: "🇦🇿", name: "Azerbaiyán" },
    UZ: { score: 0, flag: "🇺🇿", name: "Uzbekistán" },
    KZ: { score: 0, flag: "🇰🇿", name: "Kazajistán" },
    MN: { score: 0, flag: "🇲🇳", name: "Mongolia" },
    GLOBAL: { score: 0, flag: "", name: "Sin definir" }
};

function normalizeCountryText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toUpperCase();
}

function compactCountryText(value) {
    return normalizeCountryText(value).replace(/\s+/g, "");
}

function getFlagImageUrl(code) {
    const normalized = String(code || "").trim().toLowerCase();
    if (!normalized || normalized === "global") return "";
    return `https://flagcdn.com/w160/${normalized}.png`;
}

const MANUAL_ALIASES = {
    US: ["USA", "EEUU", "EE UU", "ESTADOS UNIDOS", "UNITED STATES", "AMERICA"],
    DO: ["REPUBLICA DOMINICANA", "REP DOMINICANA", "RD"],
    GB: ["UK", "UNITED KINGDOM", "GRAN BRETANA", "GRAN BRETAÑA", "INGLATERRA"],
    PE: ["PERU"],
    MX: ["MEXICO"],
    PA: ["PANAMA"],
    EC: ["ECUADOR"],
    SV: ["ELSALVADOR", "EL SALVADOR"],
    CR: ["COSTARICA", "COSTA RICA"],
    PR: ["PUERTORICO", "PUERTO RICO"],
    TT: ["TRINIDAD", "TRINIDAD Y TOBAGO"],
    HK: ["HONGKONG", "HONG KONG"],
    AE: ["EMIRATOS", "EMIRATOS ARABES", "EMIRATOS ÁRABES"],
    CZ: ["REPUBLICA CHECA", "REPUBLICA CHEQUIA"],
    MK: ["MACEDONIA", "MACEDONIA DEL NORTE"],
    KR: ["COREA", "COREA DEL SUR"],
    VE: ["VENEZUELA"],
    AR: ["ARGENTINA"],
    CO: ["COLOMBIA"],
    BR: ["BRASIL"],
    CL: ["CHILE"],
    UY: ["URUGUAY"],
    BO: ["BOLIVIA"],
    PY: ["PARAGUAY"]
};

const COUNTRY_ALIASES = {};
const NAME_TO_CODE = {};

for (const [code, country] of Object.entries(DEFAULT_COUNTRIES)) {
    const aliasSet = new Set();
    aliasSet.add(code);
    aliasSet.add(normalizeCountryText(country.name));
    aliasSet.add(compactCountryText(country.name));
    aliasSet.add(normalizeCountryText(country.flag));
    (MANUAL_ALIASES[code] || []).forEach((alias) => {
        aliasSet.add(normalizeCountryText(alias));
        aliasSet.add(compactCountryText(alias));
    });
    COUNTRY_ALIASES[code] = Array.from(aliasSet).filter(Boolean);
    if (code !== "GLOBAL") {
        NAME_TO_CODE[normalizeCountryText(country.name)] = code;
        NAME_TO_CODE[compactCountryText(country.name)] = code;
    }
}

function resolveCountryCodeFromText(text) {
    const normalized = normalizeCountryText(text);
    const compact = compactCountryText(text);
    if (!normalized) return null;

    const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
    const compactTokens = new Set(Array.from(tokens).map((token) => compactCountryText(token)));

    for (const [code, aliases] of Object.entries(COUNTRY_ALIASES)) {
        if (code === "GLOBAL") continue;
        for (const alias of aliases) {
            const compactAlias = compactCountryText(alias);
            if (normalized === alias || compact === compactAlias) return code;
            if (tokens.has(alias) || compactTokens.has(compactAlias)) return code;
            if (normalized.includes(alias) || compact.includes(compactAlias)) return code;
        }
    }

    return null;
}

const GIFT_DATA = {
    "Rose": 1,
    "Ice Cream": 1,
    "Tiny Dino": 10,
    "Baby Fox": 20,
    "Perfume": 20,
    "Donut": 30,
    "I Love You": 49,
    "Love Balloon": 99,
    "Confetti": 100,
    "Boxing Gloves": 100,
    "Dancing Bears": 100,
    "Elephant Trunk": 100,
    "Sunglasses": 199,
    "Rock n Roll": 299,
    "Fireworks": 300,
    "Spaghetti Kiss": 300,
    "Sweet Dreams": 399,
    "Forever Rosa": 399,
    "Money Rain": 500,
    "Galaxy": 1000,
    "Disco Ball": 1000,
    "Diamond Ring": 1000,
    "Magic Lamp": 1000,
    "Mirror Flower": 1000,
    "Tree House": 2000,
    "Sports Car": 2000,
    "Silver Sports Car": 2000,
    "Mermaid": 2988,
    "TikTok Shuttle": 5000,
    "TikTok Trophy": 5000,
    "Airplane": 6000,
    "Planet": 15000,
    "Diamond Flight": 18000,
    "Castle": 20000,
    "Dragon Flame": 26999,
    "Lion": 29999,
    "TikTok Universe": 44999
};

module.exports = {
    DEFAULT_COUNTRIES,
    NAME_TO_CODE,
    COUNTRY_ALIASES,
    GIFT_DATA,
    normalizeCountryText,
    resolveCountryCodeFromText,
    getFlagImageUrl
};
