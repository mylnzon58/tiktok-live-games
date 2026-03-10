const axios = require('axios');

async function getTikTokUserCountry(username) {
    try {
        const url = `https://www.tiktok.com/@${username}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });

        // Buscar en el script rehydration
        // window.__UNIVERSAL_DATA_FOR_REHYDRATION__
        const regex = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)<\/script>/;
        const match = data.match(regex);
        if (match && match[1]) {
            const jsonData = JSON.parse(match[1]);
            const userDetail = jsonData.__DEFAULT_SCOPE__['webapp.user-detail'];
            const userInfo = userDetail?.userInfo?.user;

            console.log(`Username: ${username}`);
            console.log(`Region/CountryCode from web:`, userInfo?.region);
            return userInfo?.region;
        } else {
            // Buscar region directa "region":"XX"
            const regionMatch = data.match(/"region":"([A-Za-z]+)"/);
            if (regionMatch) {
                console.log(`Matched region fallback: ${regionMatch[1]}`);
                return regionMatch[1];
            }
        }
        console.log(`Country extraction failed for ${username}`);
        return null;
    } catch (error) {
        console.error(`Error fetching ${username}:`, error.message);
        return null;
    }
}

getTikTokUserCountry('productos.digital18');
getTikTokUserCountry('juanjoclassic');
