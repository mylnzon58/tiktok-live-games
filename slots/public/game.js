// ==========================================
// TRAGAMONEDAS LIVE — cliente (/slots)
// Render-only: giros, símbolos y premios vienen del manager.
// ==========================================

(function () {
    const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];

    const $ = (id) => document.getElementById(id);
    let socket = null;
    let audioCtx = null;
    let soundEnabled = false;

    const els = {
        timer: $("main-timer"),
        roundLabel: $("round-label"),
        announcer: $("announcer-container"),
        reels: [$("reel-0"), $("reel-1"), $("reel-2")],
        lever: $("lever"),
        statSpins: $("stat-spins"),
        statJackpots: $("stat-jackpots"),
        statTotal: $("stat-total"),
        rankingList: $("ranking-list"),
        floating: $("floating-ui-layer"),
        canvas: $("fx-canvas"),
        statusDot: $("status-dot"),
        statusText: $("status-text"),
        roundOverlay: $("round-overlay"),
        soundBtn: $("sound-btn")
    };

    const fxCtx = els.canvas.getContext("2d");
    let particles = [];

    // ---- Audio ----
    function initAudio() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function beep(freq, dur, vol, type) {
        if (!soundEnabled || !audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type || "square";
        osc.frequency.value = freq;
        gain.gain.value = vol || 0.08;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur / 1000);
        osc.stop(audioCtx.currentTime + dur / 1000);
    }

    function speak(text) {
        if (!soundEnabled || !("speechSynthesis" in window)) return;
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = "es-ES";
            u.rate = 1.05;
            speechSynthesis.speak(u);
        } catch { /* noop */ }
    }

    // ---- FX ----
    function spawnParticles(x, y, color, count, speed) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const v = (Math.random() * 0.5 + 0.2) * (speed || 6);
            particles.push({
                x, y,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v - 1,
                life: 1,
                decay: Math.random() * 0.02 + 0.012,
                color,
                size: Math.random() * 5 + 2
            });
        }
    }

    function confettiBurst() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        spawnParticles(w / 2, h * 0.35, "#ffd166", 70, 10);
        spawnParticles(w / 2, h * 0.35, "#7ee081", 50, 8);
        spawnParticles(w / 2, h * 0.35, "#fff", 40, 11);
    }

    function animate() {
        fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        particles = particles.filter(p => p.life > 0);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.07;
            p.life -= p.decay;
            fxCtx.globalAlpha = Math.max(0, p.life);
            fxCtx.fillStyle = p.color;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            fxCtx.fill();
        }
        fxCtx.globalAlpha = 1;
        requestAnimationFrame(animate);
    }

    function floatMsg(text, big) {
        const div = document.createElement("div");
        div.className = "float-msg" + (big ? " big" : "");
        div.textContent = text;
        els.floating.appendChild(div);
        setTimeout(() => div.remove(), 2800);
    }

    function announce(text, jackpot) {
        const div = document.createElement("div");
        div.className = "announcer" + (jackpot ? " jackpot" : "");
        div.textContent = text;
        els.announcer.appendChild(div);
        speak(text);
        setTimeout(() => div.remove(), 5000);
        while (els.announcer.children.length > 3) {
            els.announcer.removeChild(els.announcer.firstChild);
        }
    }

    // ---- Reels ----
    function setSymbol(i, symbol) {
        const reel = els.reels[i];
        if (!reel) return;
        reel.classList.remove("rolling");
        const span = reel.querySelector(".reel-symbol");
        span.textContent = symbol;
        reel.classList.toggle("symbol-7", symbol === "7️⃣");
        reel.classList.toggle("symbol-diamond", symbol === "💎");
    }

    function startRolling() {
        els.reels.forEach((reel, i) => {
            if (!reel) return;
            reel.classList.add("rolling");
            setInterval(() => {
                if (!reel.classList.contains("rolling")) return;
                const span = reel.querySelector(".reel-symbol");
                if (span) span.textContent = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
            }, 90 + i * 30);
            beep(200 + Math.random() * 300, 60, 0.04, "square");
        });
    }

    function stopRolling(symbols) {
        els.reels.forEach((reel) => {
            if (reel) reel.classList.remove("rolling");
        });
        symbols.forEach((s, i) => setSymbol(i, s));
    }

    function markWin(symbols, multiplier) {
        els.reels.forEach((reel) => {
            if (!reel) return;
            if (multiplier > 0 && symbols && symbols.length === 3) {
                reel.classList.add("win");
                setTimeout(() => reel.classList.remove("win"), 2500);
            }
        });
    }

    // ---- Render ----
    function fmtTime(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    }

    function renderSync(data) {
        els.timer.textContent = fmtTime(data.timeRemainingMs);
        els.statSpins.textContent = data.spins || 0;
        els.statJackpots.textContent = data.jackpots || 0;
        els.statTotal.textContent = Math.round(data.totalWon || 0) + " 💎";

        const reels = data.reels || [];
        if (reels.length === 3 && !els.reels.some(r => r && r.classList.contains("rolling"))) {
            reels.forEach((s, i) => setSymbol(i, s || "?"));
        }

        const players = data.players || [];
        els.rankingList.innerHTML = "";
        players.slice(0, 10).forEach((p, i) => {
            const row = document.createElement("div");
            row.className = "rank-row";
            const num = document.createElement("span");
            num.className = "rank-num";
            num.textContent = i + 1;
            const av = document.createElement("div");
            av.className = "rank-avatar";
            if (p.avatar) {
                const img = document.createElement("img");
                img.src = p.avatar;
                img.onerror = () => { av.textContent = "🎰"; };
                av.appendChild(img);
            } else {
                av.textContent = "🎰";
            }
            const nm = document.createElement("span");
            nm.className = "rank-name";
            nm.textContent = p.name || p.id;
            const wn = document.createElement("span");
            wn.className = "rank-won";
            wn.textContent = "+" + Math.round(p.won);
            row.appendChild(num);
            row.appendChild(av);
            row.appendChild(nm);
            row.appendChild(wn);
            els.rankingList.appendChild(row);
        });
    }

    function showRoundOverlay(podium, totalSpins, jackpots) {
        els.roundOverlay.innerHTML = "";
        const title = document.createElement("div");
        title.className = "winner-name";
        title.textContent = "🎰 FIN DE RONDA";
        els.roundOverlay.appendChild(title);
        const stats = document.createElement("div");
        stats.style.fontSize = "16px";
        stats.style.color = "#7ee081";
        stats.textContent = "Giros: " + (totalSpins || 0) + " · Jackpots: " + (jackpots || 0);
        els.roundOverlay.appendChild(stats);
        (podium || []).slice(0, 3).forEach((p, i) => {
            const line = document.createElement("div");
            line.style.fontSize = "18px";
            line.textContent = ["🥇", "🥈", "🥉"][i] + " " + (p.name || p.id) + " — +" + Math.round(p.won) + " 💎";
            els.roundOverlay.appendChild(line);
        });
        const next = document.createElement("div");
        next.className = "next-round";
        next.textContent = "Nueva ronda en unos segundos...";
        els.roundOverlay.appendChild(next);
        els.roundOverlay.classList.remove("hidden");
    }

    // ---- Socket ----
    function connect() {
        socket = io({ transports: ["websocket", "polling"] });

        socket.on("connect", () => setStatus("online", "Conectado a TikTok LIVE"));
        socket.on("disconnect", () => setStatus("offline", "Desconectado — reintentando..."));
        socket.on("status", (st) => {
            if (st && st.connected) setStatus("online", "TikTok LIVE activo");
            else setStatus("connecting", "Conectando a TikTok...");
        });

        socket.on("slots:sync", (data) => {
            renderSync(data);
        });

        socket.on("slots:spin", (data) => {
            if (!data) return;
            els.lever.classList.remove("pulled");
            void els.lever.offsetWidth;
            els.lever.classList.add("pulled");
            startRolling();
            announce((data.playerName || "Alguien") + " jala la palanca 🕹️", false);
        });

        socket.on("slots:result", (data) => {
            if (!data) return;
            stopRolling(data.symbols || []);
            if (data.jackpot) {
                markWin(data.symbols, data.multiplier);
                confettiBurst();
                floatMsg("💎 ¡JACKPOT! +" + data.won + " 💎", true);
                beep(660, 150, 0.12, "triangle");
                setTimeout(() => beep(880, 150, 0.12, "triangle"), 150);
                setTimeout(() => beep(1174, 220, 0.12, "triangle"), 300);
                speak("JACKPOT!");
            } else if (data.multiplier > 0) {
                markWin(data.symbols, data.multiplier);
                floatMsg("🎉 " + (data.symbols || []).join(" ") + " +" + data.won + " 💎", false);
                beep(520, 120, 0.09, "square");
            } else {
                floatMsg("😅 " + (data.symbols || []).join(" ") + " — ¡otro giro!", false);
                beep(240, 100, 0.06, "square");
            }
        });

        socket.on("slots:motivate", (data) => {
            if (data && data.phrase) announce(data.phrase, false);
        });

        socket.on("slots:roundEnd", (data) => {
            showRoundOverlay(data.podium, data.totalSpins, data.jackpots);
            setTimeout(() => els.roundOverlay.classList.add("hidden"), 9000);
        });
    }

    function setStatus(cls, text) {
        els.statusDot.className = "dot " + cls;
        els.statusText.textContent = text;
    }

    els.soundBtn.addEventListener("click", () => {
        initAudio();
        soundEnabled = !soundEnabled;
        els.soundBtn.textContent = soundEnabled ? "🔇 Silenciar" : "🔊 Activar Sonido";
        if (soundEnabled) beep(660, 120, 0.1, "triangle");
    });

    animate();
    connect();
})();
