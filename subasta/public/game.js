// ==========================================
// SUBASTA REAL — cliente (/subasta)
// Render-only: premio, pujas y ganador vienen del manager.
// ==========================================

(function () {
    const $ = (id) => document.getElementById(id);
    let socket = null;
    let audioCtx = null;
    let soundEnabled = false;

    const els = {
        timer: $("main-timer"),
        roundLabel: $("round-label"),
        announcer: $("announcer-container"),
        prizeEmoji: $("prize-emoji"),
        prizeName: $("prize-name"),
        prizeValue: $("prize-value"),
        phaseBanner: $("phase-banner"),
        bidsList: $("bids-list"),
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
        osc.type = type || "triangle";
        osc.frequency.value = freq;
        gain.gain.value = vol || 0.1;
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
        spawnParticles(w / 2, h * 0.35, "#ffd166", 60, 9);
        spawnParticles(w / 2, h * 0.35, "#b85bd3", 40, 8);
        spawnParticles(w / 2, h * 0.35, "#fff", 30, 10);
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

    function announce(text, leader) {
        const div = document.createElement("div");
        div.className = "announcer" + (leader ? " leader" : "");
        div.textContent = text;
        els.announcer.appendChild(div);
        speak(text);
        setTimeout(() => div.remove(), 5000);
        while (els.announcer.children.length > 3) {
            els.announcer.removeChild(els.announcer.firstChild);
        }
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
        els.roundLabel.textContent = "SUBASTA #" + (data.round || 1);

        if (data.prize) {
            els.prizeEmoji.textContent = data.prize.emoji || "🎁";
            els.prizeName.textContent = data.prize.name || "— PREMIO EN JUEGO —";
            els.prizeValue.textContent = data.prize.value || "";
        }

        if (data.phase === "ending") {
            els.phaseBanner.classList.remove("hidden");
        } else {
            els.phaseBanner.classList.add("hidden");
        }

        const bids = data.bids || [];
        els.bidsList.innerHTML = "";
        bids.slice(0, 8).forEach((b, i) => {
            const row = document.createElement("div");
            row.className = "bid-row" + (i === 0 ? " leader" : "");
            const av = document.createElement("div");
            av.className = "bid-avatar";
            if (b.avatar) {
                const img = document.createElement("img");
                img.src = b.avatar;
                img.onerror = () => { av.textContent = "💰"; };
                av.appendChild(img);
            } else {
                av.textContent = "💰";
            }
            const nm = document.createElement("span");
            nm.className = "bid-name";
            nm.textContent = b.name || b.id;
            const tot = document.createElement("span");
            tot.className = "bid-total";
            tot.textContent = b.diamonds + " 💎";
            row.appendChild(av);
            row.appendChild(nm);
            row.appendChild(tot);
            els.bidsList.appendChild(row);
        });
        if (bids.length === 0) {
            const empty = document.createElement("div");
            empty.style.color = "rgba(255,255,255,.5)";
            empty.style.fontSize = "13px";
            empty.style.padding = "6px 8px";
            empty.textContent = "Aún no hay pujas. ¡Manda un regalo!";
            els.bidsList.appendChild(empty);
        }
    }

    function showWinner(prize, winner, podium) {
        els.roundOverlay.innerHTML = "";
        const emoji = document.createElement("div");
        emoji.className = "winner-emoji";
        emoji.textContent = (prize && prize.emoji) || "🏆";
        els.roundOverlay.appendChild(emoji);
        const name = document.createElement("div");
        name.className = "winner-name";
        name.textContent = winner ? winner.name + " GANA LA SUBASTA" : "NADIE PUDÓ PAGAR EL PREMIO";
        els.roundOverlay.appendChild(name);
        if (prize) {
            const line = document.createElement("div");
            line.className = "prize-line";
            line.textContent = "Se lleva: " + prize.name + (winner ? " por " + winner.diamonds + " 💎" : "");
            els.roundOverlay.appendChild(line);
        }
        (podium || []).slice(0, 3).forEach((p, i) => {
            const line = document.createElement("div");
            line.style.fontSize = "17px";
            line.textContent = ["🥇", "🥈", "🥉"][i] + " " + (p.name || p.id) + " — " + p.diamonds + " 💎";
            els.roundOverlay.appendChild(line);
        });
        const next = document.createElement("div");
        next.className = "next-round";
        next.textContent = "Nueva subasta en unos segundos...";
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

        socket.on("subasta:sync", (data) => {
            renderSync(data);
        });

        socket.on("subasta:bid", (data) => {
            if (!data) return;
            floatMsg("🔨 " + (data.bidder.name || "Alguien") + " puja +" + data.diamonds + " 💎 (" + data.total + " total)");
            beep(500 + Math.random() * 300, 80, 0.06, "triangle");
        });

        socket.on("subasta:motivate", (data) => {
            if (data && data.phrase) announce(data.phrase, false);
        });

        socket.on("subasta:winner", (data) => {
            confettiBurst();
            announce("👑 ¡" + (data.winner ? data.winner.name : "Nadie") + " gana la subasta!", true);
            showWinner(data.prize, data.winner, data.podium);
            setTimeout(() => els.roundOverlay.classList.add("hidden"), 10000);
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
