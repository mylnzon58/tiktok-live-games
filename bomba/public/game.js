// ==========================================
// LA BOMBA — cliente (/bomba)
// Render-only: todo estado llega por socket desde bomba-manager.
// ==========================================

(function () {
    const CONFIG = {
        maxRankingRows: 12
    };

    const $ = (id) => document.getElementById(id);
    let socket = null;
    let audioCtx = null;
    let soundEnabled = false;

    const els = {
        timer: $("main-timer"),
        roundLabel: $("round-label"),
        announcer: $("announcer-container"),
        holderAvatar: $("holder-avatar"),
        holderName: $("holder-name"),
        holderScore: $("holder-score"),
        bombIcon: $("bomb-icon"),
        fuseFill: $("fuse-fill"),
        fuseLabel: $("fuse-label"),
        rankingList: $("ranking-list"),
        hofList: $("hof-list"),
        floating: $("floating-ui-layer"),
        canvas: $("fx-canvas"),
        statusDot: $("status-dot"),
        statusText: $("status-text"),
        roundOverlay: $("round-overlay"),
        soundBtn: $("sound-btn")
    };

    const fxCtx = els.canvas.getContext("2d");
    let particles = [];
    let shakeMs = 0;

    // ---- Audio sintetizado ----
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
            const v = (Math.random() * 0.5 + 0.2) * (speed || 4);
            particles.push({
                x, y,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v - 1.5,
                life: 1,
                decay: Math.random() * 0.02 + 0.015,
                color,
                size: Math.random() * 6 + 2
            });
        }
    }

    function explodeFx() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        spawnParticles(w / 2, h / 2, "#ff6b6b", 70, 9);
        spawnParticles(w / 2, h / 2, "#ffd166", 50, 7);
        spawnParticles(w / 2, h / 2, "#fff", 30, 10);
        shakeMs = 500;
    }

    function animate() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        fxCtx.clearRect(0, 0, w, h);
        particles = particles.filter(p => p.life > 0);
        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.08;
            p.life -= p.decay;
            fxCtx.globalAlpha = Math.max(0, p.life);
            fxCtx.fillStyle = p.color;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            fxCtx.fill();
        }
        fxCtx.globalAlpha = 1;
        if (shakeMs > 0) {
            shakeMs -= 16;
            document.body.style.transform = "translate(" +
                (Math.random() * 10 - 5) + "px," + (Math.random() * 10 - 5) + "px)";
        } else {
            document.body.style.transform = "";
        }
        requestAnimationFrame(animate);
    }

    function floatMsg(text, danger) {
        const div = document.createElement("div");
        div.className = "float-msg" + (danger ? " danger" : "");
        div.textContent = text;
        els.floating.appendChild(div);
        setTimeout(() => div.remove(), 2600);
    }

    function announce(text, normal) {
        const div = document.createElement("div");
        div.className = "announcer" + (normal ? " normal" : "");
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

    function avatarEl(row) {
        const div = document.createElement("div");
        div.className = "rank-avatar";
        if (row.avatar) {
            const img = document.createElement("img");
            img.src = row.avatar;
            img.onerror = () => { div.textContent = "🙂"; };
            div.appendChild(img);
        } else {
            div.textContent = "🙂";
        }
        return div;
    }

    function renderRanking(players, holderId) {
        const list = (players || []).slice().sort((a, b) => b.score - a.score).slice(0, CONFIG.maxRankingRows);
        els.rankingList.innerHTML = "";
        list.forEach((p, i) => {
            const row = document.createElement("div");
            row.className = "rank-row" + (p.id === holderId ? " holding" : "");
            const num = document.createElement("span");
            num.className = "rank-num";
            num.textContent = i + 1;
            const nm = document.createElement("span");
            nm.className = "rank-name";
            nm.textContent = p.name || p.id;
            const sc = document.createElement("span");
            sc.className = "rank-score";
            sc.textContent = p.score;
            row.appendChild(num);
            row.appendChild(avatarEl(p));
            row.appendChild(nm);
            row.appendChild(sc);
            els.rankingList.appendChild(row);
        });
    }

    function renderHOF(hof) {
        els.hofList.innerHTML = "";
        (hof || []).slice(0, 10).forEach((w, i) => {
            const row = document.createElement("div");
            row.className = "rank-row";
            const num = document.createElement("span");
            num.className = "rank-num";
            num.textContent = i + 1;
            const nm = document.createElement("span");
            nm.className = "rank-name";
            nm.textContent = w.name || "Anónimo";
            const sc = document.createElement("span");
            sc.className = "rank-score";
            sc.textContent = w.score + " pts";
            row.appendChild(num);
            row.appendChild(avatarEl(w));
            row.appendChild(nm);
            row.appendChild(sc);
            els.hofList.appendChild(row);
        });
    }

    function renderSync(data) {
        els.timer.textContent = fmtTime(data.timeRemainingMs);
        const holder = (data.players || []).find(p => p.id === data.holder);
        if (holder) {
            els.holderName.textContent = holder.name || holder.id;
            els.holderScore.textContent = holder.score + " pts";
            els.holderAvatar.innerHTML = "";
            if (holder.avatar) {
                const img = document.createElement("img");
                img.src = holder.avatar;
                img.onerror = () => { els.holderAvatar.textContent = "🙂"; };
                els.holderAvatar.appendChild(img);
            } else {
                els.holderAvatar.textContent = "🙂";
            }
        } else {
            els.holderName.textContent = data.phase === "finished" ? "RONDA TERMINADA" : "ESPERANDO JUGADORES...";
            els.holderScore.textContent = "";
            els.holderAvatar.textContent = "❓";
        }

        if (data.fuseMs != null) {
            const ratio = Math.max(0, data.fuseMs / 30000);
            els.fuseFill.style.width = (ratio * 100) + "%";
            els.fuseFill.style.background = ratio > 0.5
                ? "linear-gradient(90deg,#ffd166,#ff9f43)"
                : "linear-gradient(90deg,#ff9f43,#ff6b6b)";
            els.fuseLabel.textContent = ratio < 0.33 ? "🔥 ¡MEJOR PÁSALA YA!" : "MECHA";
            if (ratio < 0.33) beep(220 + Math.random() * 200, 90, 0.08, "square");
        }
        renderRanking(data.players, data.holder);
    }

    function showRoundOverlay(winnerName, winnerAvatar, podium, hof) {
        els.roundOverlay.innerHTML = "";
        const title = document.createElement("div");
        title.className = "winner-name";
        title.textContent = "💣 RONDA FINALIZADA";
        const sub = document.createElement("div");
        sub.style.fontSize = "18px";
        sub.style.color = "#7ee081";
        sub.textContent = "🏆 GANADOR: " + (winnerName || "Nadie");
        els.roundOverlay.appendChild(title);
        els.roundOverlay.appendChild(sub);

        const podiumEl = document.createElement("div");
        podiumEl.className = "podium";
        const medals = ["🥇", "🥈", "🥉"];
        (podium || []).slice(0, 3).forEach((p, i) => {
            const slot = document.createElement("div");
            slot.className = "slot";
            slot.innerHTML = '<div class="medal">' + medals[i] + '</div><div class="nm">' +
                (p.name || p.id) + '</div><div class="score">' + p.score + ' pts</div>';
            podiumEl.appendChild(slot);
        });
        els.roundOverlay.appendChild(podiumEl);
        renderHOF(hof);
        els.roundOverlay.classList.remove("hidden");
    }

    // ---- Socket ----
    function connect() {
        socket = io({ transports: ["websocket", "polling"] });

        socket.on("connect", () => {
            setStatus("online", "Conectado a TikTok LIVE");
        });
        socket.on("disconnect", () => {
            setStatus("offline", "Desconectado — reintentando...");
        });
        socket.on("status", (st) => {
            if (st && st.connected) setStatus("online", "TikTok LIVE activo");
            else setStatus("connecting", "Conectando a TikTok...");
        });

        socket.on("bomba:sync", (data) => {
            renderSync(data);
            if (data.hof) renderHOF(data.hof);
        });

        socket.on("bomba:pass", (data) => {
            floatMsg("💣 → " + (data.toName || data.toId), false);
            beep(520, 120, 0.08, "square");
        });

        socket.on("bomba:boom", (data) => {
            explodeFx();
            floatMsg("💥 ¡BOOM! " + (data.victimName || data.victimId) + " -" + data.penalty + " pts", true);
            beep(90, 450, 0.18, "sawtooth");
            speak("BOOM!");
        });

        socket.on("bomba:motivate", (data) => {
            if (data && data.phrase) announce(data.phrase, true);
        });

        socket.on("bomba:roundEnd", (data) => {
            announce("🏆 ¡" + (data.winnerName || "Nadie") + " gana la ronda!", false);
            showRoundOverlay(data.winnerName, data.winnerAvatar, data.podium, data.hof);
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
