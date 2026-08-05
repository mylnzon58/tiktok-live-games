// ==========================================
// RULETA DE LA FORTUNA — cliente (/ruleta)
// Render-only: apuestas, giros y resultados vienen del manager.
// ==========================================

(function () {
    const COLORS = ["red", "black", "green", "red", "black", "red", "black", "red", "black", "green", "red", "black"];
    const SEGMENTS = 12;
    const SEG_DEG = 360 / SEGMENTS;

    const $ = (id) => document.getElementById(id);
    let socket = null;
    let audioCtx = null;
    let soundEnabled = false;
    let wheelRotation = 0;

    const els = {
        timer: $("main-timer"),
        roundLabel: $("round-label"),
        announcer: $("announcer-container"),
        wheel: $("wheel"),
        betRed: $("bet-red-total"),
        betBlack: $("bet-black-total"),
        betGreen: $("bet-green-total"),
        rankingList: $("ranking-list"),
        spinStats: $("spin-stats"),
        floating: $("floating-ui-layer"),
        canvas: $("fx-canvas"),
        statusDot: $("status-dot"),
        statusText: $("status-text"),
        roundOverlay: $("round-overlay"),
        soundBtn: $("sound-btn")
    };

    const fxCtx = els.canvas.getContext("2d");
    let particles = [];

    // ---- Wheel build ----
    function buildWheel() {
        els.wheel.innerHTML = "";
        COLORS.forEach((color, i) => {
            const seg = document.createElement("div");
            seg.className = "segment " + color;
            seg.style.transform = "rotate(" + (i * SEG_DEG) + "deg)";
            const label = document.createElement("span");
            label.textContent = i === 5 || i === 11 ? "x10" : "x" + [1, 2, 3, 5, 10][Math.floor(Math.random() * 5)];
            seg.appendChild(label);
            els.wheel.appendChild(seg);
        });
    }

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
            const v = (Math.random() * 0.5 + 0.2) * (speed || 5);
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
        spawnParticles(w / 2, h * 0.4, "#ffd166", 50, 8);
        spawnParticles(w / 2, h * 0.4, "#7ee081", 40, 7);
        spawnParticles(w / 2, h * 0.4, "#fff", 30, 9);
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

    function floatMsg(text) {
        const div = document.createElement("div");
        div.className = "float-msg";
        div.textContent = text;
        els.floating.appendChild(div);
        setTimeout(() => div.remove(), 2800);
    }

    function announce(text, win) {
        const div = document.createElement("div");
        div.className = "announcer" + (win ? " win" : "");
        div.textContent = text;
        els.announcer.appendChild(div);
        speak(text);
        setTimeout(() => div.remove(), 5000);
        while (els.announcer.children.length > 3) {
            els.announcer.removeChild(els.announcer.firstChild);
        }
    }

    // ---- Wheel spin ----
    function landOnColor(color) {
        const indices = COLORS.map((c, i) => (c === color ? i : -1)).filter(i => i >= 0);
        const idx = indices[Math.floor(Math.random() * indices.length)];
        const targetDeg = -(idx * SEG_DEG + SEG_DEG / 2);
        const current = wheelRotation % 360;
        let delta = targetDeg - current;
        if (delta < 0) delta += 360;
        wheelRotation += 360 * 6 + delta;
        els.wheel.style.transform = "rotate(" + wheelRotation + "deg)";
    }

    function quickSpin() {
        wheelRotation += 540;
        els.wheel.style.transform = "rotate(" + wheelRotation + "deg)";
        beep(200 + Math.random() * 300, 60, 0.05, "square");
    }

    // ---- Render ----
    function fmtTime(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    }

    function sumBets(bucket) {
        return Object.values(bucket || {}).reduce((acc, b) => acc + (b.diamonds || 0), 0);
    }

    function renderSync(data) {
        els.timer.textContent = fmtTime(data.timeRemainingMs);
        els.betRed.textContent = sumBets(data.bets && data.bets.red) + " 💎";
        els.betBlack.textContent = sumBets(data.bets && data.bets.black) + " 💎";
        els.betGreen.textContent = sumBets(data.bets && data.bets.green) + " 💎";

        els.spinStats.textContent = "Giros: " + (data.spinCount || 0) + " · Multiplicador: x" + (data.lastMultiplier || 1);

        const winners = data.winners || [];
        els.rankingList.innerHTML = "";
        winners.slice(0, 10).forEach((w, i) => {
            const row = document.createElement("div");
            row.className = "rank-row";
            const num = document.createElement("span");
            num.className = "rank-num";
            num.textContent = i + 1;
            const av = document.createElement("div");
            av.className = "rank-avatar";
            if (w.avatar) {
                const img = document.createElement("img");
                img.src = w.avatar;
                img.onerror = () => { av.textContent = "🎲"; };
                av.appendChild(img);
            } else {
                av.textContent = "🎲";
            }
            const nm = document.createElement("span");
            nm.className = "rank-name";
            nm.textContent = w.name || w.id;
            const wn = document.createElement("span");
            wn.className = "rank-won";
            wn.textContent = "+" + Math.round(w.won);
            row.appendChild(num);
            row.appendChild(av);
            row.appendChild(nm);
            row.appendChild(wn);
            els.rankingList.appendChild(row);
        });
    }

    function showRoundOverlay(podium, totalSpins) {
        els.roundOverlay.innerHTML = "";
        const title = document.createElement("div");
        title.className = "winner-name";
        title.textContent = "🎡 FIN DE RONDA";
        els.roundOverlay.appendChild(title);
        const stats = document.createElement("div");
        stats.style.fontSize = "16px";
        stats.style.color = "#7ee081";
        stats.textContent = "Giros totales: " + (totalSpins || 0);
        els.roundOverlay.appendChild(stats);
        (podium || []).slice(0, 3).forEach((p, i) => {
            const line = document.createElement("div");
            line.style.fontSize = "18px";
            line.textContent = ["🥇", "🥈", "🥉"][i] + " " + (p.name || p.id) + " — " + Math.round(p.won) + " 💎";
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

        socket.on("ruleta:sync", (data) => {
            renderSync(data);
        });

        socket.on("ruleta:spin", (data) => {
            quickSpin();
            announce((data.byName || "Alguien") + " hace girar la ruleta con " + data.diamonds + " 💎", false);
        });

        socket.on("ruleta:result", (data) => {
            landOnColor(data.color);
            const colorEmoji = data.color === "red" ? "🔴" : data.color === "green" ? "🟢" : "⚫";
            floatMsg(colorEmoji + " ¡" + data.color.toUpperCase() + "! x" + data.multiplier);
            if (data.multiplier >= 5) {
                confettiBurst();
                beep(880, 160, 0.1, "triangle");
                setTimeout(() => beep(1174, 220, 0.1, "triangle"), 160);
            } else {
                beep(440, 120, 0.08, "square");
            }
            if (data.totalWon > 0) {
                announce("🔴 ROJO gana x" + data.multiplier + " — " + data.totalWon + " 💎 repartidos", true);
            }
        });

        socket.on("ruleta:motivate", (data) => {
            if (data && data.phrase) announce(data.phrase, false);
        });

        socket.on("ruleta:roundEnd", (data) => {
            showRoundOverlay(data.podium, data.totalSpins);
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

    buildWheel();
    animate();
    connect();
})();
