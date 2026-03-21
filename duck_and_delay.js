const fs = require('fs');
let code = fs.readFileSync('arena.js', 'utf8');

// 1. Ducking en flushSpeechQueue
const duckEnd1 = `    msg.onend = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, next.gapMs ?? 300);
    };
    msg.onerror = () => {
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, 400);
    };`;

const duckReplacement1 = `    msg.onstart = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.04, audioCtx.currentTime, 0.1);
        }
    };
    msg.onend = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.15);
        }
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, next.gapMs ?? 300);
    };
    msg.onerror = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.1);
        }
        lastSpeechAt = Date.now();
        speechTimer = window.setTimeout(flushSpeechQueue, 400);
    };`;

if (code.includes(duckEnd1)) {
    code = code.replace(duckEnd1, duckReplacement1);
} else if (code.includes(duckEnd1.replace(/\r/g, ""))) {
    code = code.replace(duckEnd1.replace(/\r/g, ""), duckReplacement1);
} else {
    // Si no lo encuentra exacto, buscamos fragmentos
    console.error("Ducking 1 target not found");
}

// 2. Ducking en speakImmediate
const duckEnd2 = `    msg.onend = () => {
        lastSpeechAt = Date.now();
    };
    msg.onerror = () => {
        lastSpeechAt = Date.now();
    };`;

const duckReplacement2 = `    msg.onstart = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.04, audioCtx.currentTime, 0.1);
        }
    };
    msg.onend = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.15);
        }
        lastSpeechAt = Date.now();
    };
    msg.onerror = () => {
        if (audioCtx && masterAudioGain) {
            masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.1);
        }
        lastSpeechAt = Date.now();
    };`;

if (code.includes(duckEnd2)) {
    code = code.replace(duckEnd2, duckReplacement2);
} else if (code.includes(duckEnd2.replace(/\r/g, ""))) {
    code = code.replace(duckEnd2.replace(/\r/g, ""), duckReplacement2);
} else {
    console.error("Ducking 2 target not found");
}

// 3. Reordenar regalo: Voz y luego impacto
const giftStart = `    showAnnouncer(giftNarration.overlay, giftValue >= 500 ? "#ffd166" : (giftValue >= 20 ? "#7dd3fc" : "#f8fafc"));
    if (diamondsTotal >= 1) { // AHORA TODOS los regalos se leen por voz.
        announce(giftNarration.voice, { gapMs: 700 });
    }

    // Detección de tipos de ataque: utilizar tanto la clave sugerida como los fallbacks.
    if (giftEffect.type === "megaBlast") {`;

const giftReplacement = `    showAnnouncer(giftNarration.overlay, giftValue >= 500 ? "#ffd166" : (giftValue >= 20 ? "#7dd3fc" : "#f8fafc"));
    if (diamondsTotal >= 1) { 
        announce(giftNarration.voice, { gapMs: 700 });
    }

    // --- SECUENCIA: VOZ PRIMERO, LUEGO ATAQUE ---
    const impactDelay = diamondsTotal >= 10 ? 1200 : 600; 

    setTimeout(() => {
        executeGiftImpact(giftEffect, data, attacker, target, diamondsTotal, giftValue, count, color, damage, fxProfile, sizeDominance);
    }, impactDelay);
});

function executeGiftImpact(giftEffect, data, attacker, target, diamondsTotal, giftValue, count, color, damage, fxProfile, sizeDominance) {
    if (giftEffect.type === "megaBlast") {`;

if (code.includes(giftStart)) {
    code = code.replace(giftStart, giftReplacement);
} else if (code.includes(giftStart.replace(/\r/g, ""))) {
    code = code.replace(giftStart.replace(/\r/g, ""), giftReplacement);
} else {
    console.error("Gift start target not found");
}

// Cambio de atkType a giftEffect.type ya que atkType se definía más arriba pero lo estamos moviendo
code = code.replace('if (atkType === "projectile")', 'if (giftEffect.type === "tapSpark" || giftEffect.type === "projectile")');
code = code.replace('} else if (atkType === "lightning")', '} else if (giftEffect.type === "lightningStorm" || giftEffect.type === "lightning")');
code = code.replace('} else if (atkType === "laser")', '} else if (giftEffect.type === "laser")');

fs.writeFileSync('arena.js', code);
console.log("Done!");
