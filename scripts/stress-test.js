const { io } = require("socket.io-client");
const { performance } = require("perf_hooks");

const URL = "http://127.0.0.1:3000";
const WAIT_AFTER_PHASE_MS = 1800;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpHealthCheck() {
    const [overlayRes, arenaRes] = await Promise.all([
        fetch(`${URL}/overlay`),
        fetch(`${URL}/arena`)
    ]);

    return {
        overlay: overlayRes.status,
        arena: arenaRes.status
    };
}

async function main() {
    const health = await httpHealthCheck();
    const socket = io(URL, {
        transports: ["websocket"],
        timeout: 5000
    });

    const counters = {
        rankingUpdate: 0,
        arenaSync: 0,
        arenaGift: 0,
        arenaCurrentRanking: 0,
        arenaBurst: 0,
        arenaPowerup: 0,
        bigGift: 0
    };

    const phaseResults = [];

    socket.on("rankingUpdate", () => { counters.rankingUpdate += 1; });
    socket.on("arena:sync", () => { counters.arenaSync += 1; });
    socket.on("arena:gift", () => { counters.arenaGift += 1; });
    socket.on("arena:currentRanking", () => { counters.arenaCurrentRanking += 1; });
    socket.on("arena:burst", () => { counters.arenaBurst += 1; });
    socket.on("arena:powerup", () => { counters.arenaPowerup += 1; });
    socket.on("bigGift", () => { counters.bigGift += 1; });

    await new Promise((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("connect_error", reject);
    });

    async function runPhase(name, giftName, diamondCount, totalEvents, users, spacingMs = 0) {
        const before = { ...counters };
        const t0 = performance.now();

        for (let i = 0; i < totalEvents; i += 1) {
            socket.emit("arena:debug:gift", {
                giftName,
                diamondCount,
                uniqueId: `stress_${name}_user_${i % users}`
            });

            if (spacingMs > 0) {
                await sleep(spacingMs);
            }
        }

        await sleep(WAIT_AFTER_PHASE_MS);
        const elapsedMs = Math.round(performance.now() - t0);
        const after = { ...counters };

        const delta = {};
        for (const key of Object.keys(after)) {
            delta[key] = after[key] - before[key];
        }

        phaseResults.push({
            name,
            giftName,
            diamondCount,
            totalEvents,
            users,
            elapsedMs,
            delta
        });
    }

    await runPhase("rose_burst", "Rose", 1, 250, 20);
    await runPhase("donut_wave", "Donut", 30, 180, 18);
    await runPhase("galaxy_stress", "Galaxy", 1000, 70, 10, 5);
    await runPhase("universe_spike", "TikTok Universe", 44999, 14, 6, 20);
    await runPhase("mixed_flood", "Fireworks", 300, 220, 24);

    socket.disconnect();

    console.log(JSON.stringify({
        health,
        totals: counters,
        phases: phaseResults
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
