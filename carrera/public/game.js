// ==========================================
// CARRERA DE AVATARES — cliente (/carrera)
// Render-only: posiciones autoritativas del servidor via carrera:sync.
// ==========================================

(function () {
    const CONFIG = {
        maxLanes: 6,
        trackPaddingPct: 2,   // margen izquierdo de la pista (%)
        finishOffsetPct: 6    // deja espacio para la línea de meta (%)
    };

    const $ = (id) => document.getElementById(id);
    let socket = null;
    let audioCtx = null;
    let soundEnabled = false;
    let racerElems = {};      // id -> { elem, lane }
    let nextLane = 0;

    const els = {
        timer: $("main-timer"),
        roundLabel: $("round-label"),
        announcer: $("announcer-container"),
        lanes: $("lanes"),
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
    function spawnTrail(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.PI * (0.8 + Math.random() * 0.4);
            const v = Math.random() * 2 + 1;
            particles.push({
                x, y,
                vx: Math.cos(angle) * v - 1.5,
                vy: Math.sin(angle) * v,
                life: 1,
                decay: Math.random() * 0.04 + 0.03,
                color,
                size: Math.random() * 4 + 2
            });
        }
    }

    function animate() {
        fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        particles = particles.filter(p => p.life > 0);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
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
        setTimeout(() => div.remove(), 2600);
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

    // ---- Track setup ----
    function buildLanes() {
        els.lanes.innerHTML = "";
        const laneH = 100 / CONFIG.maxLanes;
        for (let i = 0; i < CONFIG.maxLanes; i++) {
            const lane = document.createElement("div");
            lane.className = "lane";
            lane.style.top = (i * laneH) + "%";
            lane.style.height = laneH + "%";
            const num = document.createElement("span");
            num.className = "lane-num";
            num.textContent = i + 1;
            lane.appendChild(num);
            els.lanes.appendChild(lane);
        }
    }

    function laneY(i) {
        return (i + 0.5) * (100 / CONFIG.maxLanes);
    }

    function racerX(progress, finish) {
        const usable = 100 - CONFIG.trackPaddingPct * 2 - CONFIG.finishOffsetPct;
        return CONFIG.trackPaddingPct + (progress / finish) * usable;
    }

    function ensureRacerEl(id, name, avatar, finish) {
        let entry = racerElems[id];
        if (!entry) {
            const lane = nextLane % CONFIG.maxLanes;
            nextLane++;
            const el = document.createElement("div");
            el.className = "racer";
            el.style.top = laneY(lane) + "%";
            el.style.left = racerX(0, finish) + "%";

            const av = document.createElement("div");
            av.className = "racer-avatar";
            if (avatar) {
                const img = document.createElement("img");
                img.src = avatar;
                img.onerror = () => { av.textContent = "🏃"; };
                av.appendChild(img);
            } else {
                av.textContent = "🏃";
            }
            const nm = document.createElement("span");
            nm.className = "racer-name";
            nm.textContent = name || id;

            el.appendChild(av);
            el.appendChild(nm);
            els.lanes.appendChild(el);

            entry = { el, lane, name, avatar };
            racerElems[id] = entry;
        }
        return entry;
    }

    function moveRacer(id, progress, finish, amount, leaderId) {
        const entry = racerElems[id];
        if (!entry) return;
        entry.el.style.left = racerX(progress, finish) + "%";
        entry.el.classList.toggle("leader", id === leaderId);
        if (amount && amount > 0) {
            const burst = document.createElement("span");
            burst.className = "speed-burst";
            burst.textContent = "💨";
            entry.el.appendChild(burst);
            setTimeout(() => burst.remove(), 650);
            spawnTrail(entry.el.offsetLeft + entry.el.offsetWidth, entry.el.offsetTop + 26, "#7ee081", 6);
            beep(300 + Math.random() * 400, 80, 0.05, "triangle");
        }
    }

    // ---- Render ----
    function fmtTime(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const r = s % 60;
        return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
    }

    function renderRanking(racers) {
        els.rankingList.innerHTML = "";
        racers.forEach((r, i) => {
            const row = document.createElement("div");
            row.className = "rank-row" + (i === 0 ? " first" : "");
            const num = document.createElement("span");
            num.className = "rank-num";
            num.textContent = i + 1;
            const av = document.createElement("div");
            av.className = "rank-avatar";
            if (r.avatar) {
                const img = document.createElement("img");
                img.src = r.avatar;
                img.onerror = () => { av.textContent = "🏃"; };
                av.appendChild(img);
            } else {
                av.textContent = "🏃";
            }
            const nm = document.createElement("span");
            nm.className = "rank-name";
            nm.textContent = r.name || r.id;
            const pg = document.createElement("span");
            pg.className = "rank-progress";
            pg.textContent = Math.round(r.progress) + "%";
            row.appendChild(num);
            row.appendChild(av);
            row.appendChild(nm);
            row.appendChild(pg);
            els.rankingList.appendChild(row);
        });
    }

    function renderSync(data) {
        els.timer.textContent = fmtTime(data.timeRemainingMs);
        const finish = data.finishProgress || 100;
        const racers = data.racers || [];
        const leaderId = racers[0]?.id || null;

        const seen = {};
        racers.forEach((r) => {
            seen[r.id] = true;
            ensureRacerEl(r.id, r.name, r.avatar, finish);
            moveRacer(r.id, r.progress || 0, finish, 0, leaderId);
        });
        for (const id of Object.keys(racerElems)) {
            if (!seen[id]) {
                racerElems[id].el.remove();
                delete racerElems[id];
            }
        }
        renderRanking(racers.slice(0, 12));
    }

    function showRoundOverlay(winnerName, podium) {
        els.roundOverlay.innerHTML = "";
        const title = document.createElement("div");
        title.className = "winner-name";
        title.textContent = "🏁 " + (winnerName || "Nadie") + " GANA LA CARRERA";
        els.roundOverlay.appendChild(title);
        const podiumEl = document.createElement("div");
        podiumEl.className = "podium";
        const medals = ["🥇", "🥈", "🥉"];
        (podium || []).slice(0, 3).forEach((p, i) => {
            const slot = document.createElement("div");
            slot.className = "slot";
            slot.innerHTML = '<div class="medal">' + medals[i] + '</div><div class="nm">' +
                (p.name || p.id) + '</div><div class="score">' + Math.round(p.progress) + '%</div>';
            podiumEl.appendChild(slot);
        });
        els.roundOverlay.appendChild(podiumEl);
        const next = document.createElement("div");
        next.className = "next-round";
        next.textContent = "Nueva carrera en unos segundos...";
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

        socket.on("carrera:sync", (data) => {
            renderSync(data);
        });

        socket.on("carrera:push", (data) => {
            if (!data) return;
            const entry = racerElems[data.racerId];
            if (entry) {
                floatMsg("💨 +" + data.amount.toFixed(1) + "%");
                moveRacer(data.racerId, data.progress, 100, data.amount, data.racerId);
            }
            if (data.donor && data.donor.name) {
                beep(500 + Math.random() * 300, 90, 0.06, "triangle");
            }
        });

        socket.on("carrera:motivate", (data) => {
            if (data && data.phrase) announce(data.phrase, false);
        });

        socket.on("carrera:roundEnd", (data) => {
            announce("🏁 ¡" + (data.winnerName || "Nadie") + " cruza la meta!", true);
            showRoundOverlay(data.winnerName, data.podium);
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

    buildLanes();
    animate();
    connect();
})();
