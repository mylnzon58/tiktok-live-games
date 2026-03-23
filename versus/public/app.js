const socket = io();

const DOM = {
    timer: document.getElementById("timer"),
    scores: {
        milei: document.getElementById("score-m"),
        cristina: document.getElementById("score-c")
    },
    wins: {
        milei: document.getElementById("wins-m"),
        cristina: document.getElementById("wins-c")
    },
    pfps: {
        milei: document.getElementById("pfp-m"),
        cristina: document.getElementById("pfp-c")
    },
    rings: {
        milei: document.querySelector(".ring.m"),
        cristina: document.querySelector(".ring.c")
    },
    bar: document.getElementById("bar-fill"),
    unblock: document.getElementById("unblock"),
    laneL: document.getElementById("lane-l"),
    laneR: document.getElementById("lane-r"),
    debug: document.getElementById("debug")
};

let audioOn = false;

const SFX = {
    chat: new Audio("https://assets.mixkit.co/sfx/preview/mixkit-positive-interface-click-1112.mp3"),
    hit:  new Audio("https://assets.mixkit.co/sfx/preview/mixkit-boxer-getting-hit-2055.mp3"),
    epic: new Audio("https://assets.mixkit.co/sfx/preview/mixkit-cinematic-mystery-reveal-911.mp3"),
    zap:  new Audio("https://assets.mixkit.co/sfx/preview/mixkit-electric-plasma-zap-3069.mp3"),
    win:  new Audio("https://assets.mixkit.co/sfx/preview/mixkit-medieval-show-fanfare-announcement-226.mp3")
};
Object.values(SFX).forEach(s => s.volume = 0.6);

// Himno Nacional Argentino — dominio público (Wikimedia Commons / ICPM)
const bgMusic = new Audio("https://upload.wikimedia.org/wikipedia/commons/transcoded/8/8a/Himno_Nacional_Argentino_-_ICPM_%28instrumental%29.ogg/Himno_Nacional_Argentino_-_ICPM_%28instrumental%29.ogg.mp3");
bgMusic.loop   = true;
bgMusic.volume = 0.35; // Volumen subido para que se escuche claro

// Habilitar audio explicitamente para esquivar bloqueos de Chrome
let isUnlocked = false;

function unlockAudio() {
    if (isUnlocked) return;
    isUnlocked = true;
    audioOn = true;
    
    // Despertar efectos de sonido
    Object.values(SFX).forEach(s => {
        s.volume = 0.6;
        s.play().then(() => { s.pause(); s.currentTime = 0; }).catch(()=>{});
    });

    // Iniciar himno
    bgMusic.play().catch(() => {});
}

// Intentar autoplay al cargar, sino esperar primer clic silencioso (como en arena)
bgMusic.play().then(() => {
    isUnlocked = true; 
    audioOn = true;
}).catch(() => {
    // Si lo bloquea, el primer touch/click/tecla lo destraba
    document.addEventListener("click", unlockAudio, { once: true });
    document.addEventListener("keydown", unlockAudio, { once: true });
    document.addEventListener("touchstart", unlockAudio, { once: true });
});

// Función global para debug, la llama el botón del HTML
window.testTTS = function() {
    speak("Probando la síntesis de voz. ¡León contra Pingüina!");
    play("epic");
};

if (new URLSearchParams(window.location.search).has('debug')) DOM.debug.classList.add("active");

function speak(text, isGift = false) {
    if (!audioOn) return;
    if (!window.speechSynthesis) return;
    
    // Si hay muchos mensajes pendientes, cancelamos para dar paso a lo nuevo (Prioridad Tiempo Real)
    if (window.speechSynthesis.speaking && isGift) {
        window.speechSynthesis.cancel();
    } else if (window.speechSynthesis.pending > 3) {
        // Si hay más de 3 en espera y no es un regalo, lo ignoramos para no acumular lag
        if (!isGift) return;
    }
    
    // Limpiar emojis (Safer regex)
    const cleanText = String(text).replace(/[^\x00-\x7FáéíóúÁÉÍÓÚñÑ\s\w.,!?¿¡-]/g, '');
    if (!cleanText.trim()) return;

    const u = new SpeechSynthesisUtterance(cleanText);
    u.lang = "es-AR";
    u.rate = 1.4; // Un poco más rápido para mantener el ritmo
    window.speechSynthesis.speak(u);
}

function play(key) {
    if (!audioOn) return;
    const s = SFX[key];
    if (s) { s.currentTime = 0; s.play().catch(()=>{}); }
}

function spawn(data) {
    const isL = data.fighterId === "milei";
    const lane = isL ? DOM.laneL : DOM.laneR;
    
    const bub = document.createElement("div");
    bub.className = `bubble ${isL ? 'slide-l' : 'slide-r'}`;
    // Tickers pass "centered" on the bar due to CSS flex/transform, 
    // but we can slightly randomize top within the small lane
    bub.style.top = `${Math.random() * 20 + 40}%`; 

    bub.innerHTML = `
        <img src="${data.avatar || 'https://p16-amd-va.tiktokcdn.com/img/musically-maliva-obj/1594805258216453~c5_720x720.jpeg'}" class="b-pfp">
        <span class="b-txt">${data.emoji} ${data.username}</span>
    `;

    lane.appendChild(bub);
    
    const ring = DOM.rings[data.fighterId];
    ring.classList.remove("impact");
    void ring.offsetWidth;
    ring.classList.add("impact");

    if (data.type === 'like') {
        play("zap");
    } else if (data.type === 'gift') {
        if (data.diamonds >= 500) play("epic");
        else play("hit");
    } else {
        play("chat");
    }

    setTimeout(() => bub.remove(), 3200);
}

socket.on("versus:sync", (state) => {
    const sL = Math.max(0, Math.floor((state.endTime - Date.now()) / 1000));
    DOM.timer.innerText = `${Math.floor(sL/60).toString().padStart(2,'0')}:${(sL%60).toString().padStart(2,'0')}`;

    state.fighters.forEach(f => {
        DOM.scores[f.id].innerText = f.score.toLocaleString();
        if (DOM.wins[f.id]) DOM.wins[f.id].innerText = f.wins || 0;
        // Fallback for broken images
        if (DOM.pfps[f.id] && (!DOM.pfps[f.id].src || DOM.pfps[f.id].src.includes('unknown'))) {
            DOM.pfps[f.id].src = f.avatar;
        }
    });

    const scores = { milei: state.fighters[0].score, cristina: state.fighters[1].score };
    const total = scores.milei + scores.cristina;
    const pct = total === 0 ? 50 : Math.max(5, Math.min(95, (scores.milei / total) * 100));
    DOM.bar.style.width = `${pct}%`;
});

socket.on("versus:support", spawn);
socket.on("versus:motivate", (data) => speak(data.phrase));

socket.on("versus:end", (data) => {
    DOM.timer.innerText = "FINAL";
    play("win");
    const { winnerIds, state } = data;
    const w = state.fighters.find(f => f.id === winnerIds[0]);
    if (w) speak(`¡Duelo finalizado! ¡${w.name} es el gran triunfador!`, true);
});
