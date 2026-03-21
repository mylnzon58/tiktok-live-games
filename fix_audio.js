const fs = require('fs');
const path = 'arena.js';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

// 1. Ducking en flushSpeechQueue (ya añadí onstart en el paso anterior, falta onend/onerror)
// Buscamos: msg.onend = () => {
let foundFlush = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('msg.onend = () => {') && i < 300) {
        lines[i+1] = '        if (audioCtx && masterAudioGain) masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.15);';
        lines[i+2] = '        lastSpeechAt = Date.now();';
        // etc.
        foundFlush = true;
        break;
    }
}

// 2. Ducking en speakImmediate
let foundSpeak = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function speakImmediate') && i > 300) {
        // Encontrar msg.onend
        for (let j = i; j < i + 50; j++) {
            if (lines[j].includes('msg.onend = () => {')) {
                lines.splice(j, 0, '    msg.onstart = () => { if (audioCtx && masterAudioGain) masterAudioGain.gain.setTargetAtTime(0.04, audioCtx.currentTime, 0.1); };');
                j++; // Ajustar por el splice
                lines[j+1] = '        if (audioCtx && masterAudioGain) masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.15);';
                lines[j+3] = '    msg.onerror = () => { if (audioCtx && masterAudioGain) masterAudioGain.gain.setTargetAtTime(0.12, audioCtx.currentTime, 0.1); lastSpeechAt = Date.now(); };';
                foundSpeak = true;
                break;
            }
        }
        if (foundSpeak) break;
    }
}

// 3. Reordenar Regalos
let foundGift = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('announce(giftNarration.voice') && i > 3000) {
        // Envolver el resto en timeout y cerrar el socket handler
        let start = i + 2;
        let blockToMove = [];
        let end = -1;
        for (let j = start; j < lines.length; j++) {
            blockToMove.push(lines[j]);
            if (lines[j].trim() === '});' && lines[j-1].trim() === '}') { // Fin de socket.on
                 end = j;
                 break;
            }
        }
        
        if (end !== -1) {
             const moved = blockToMove.slice(0, -1); // Sin el }); final
             lines.splice(start, blockToMove.length, 
                '    const impactDelay = diamondsTotal >= 10 ? 1200 : 800;',
                '    setTimeout(() => {',
                ...moved.map(l => '    ' + l),
                '    }, impactDelay);',
                '});'
             );
             foundGift = true;
        }
        break;
    }
}

fs.writeFileSync(path, lines.join('\r\n'));
console.log(`Flush: ${foundFlush}, Speak: ${foundSpeak}, Gift: ${foundGift}`);
