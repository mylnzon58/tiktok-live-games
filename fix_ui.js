const fs = require('fs');
let code = fs.readFileSync('arena.js', 'utf8');

// 1. Zoom Pulso en el líder
const zoomTarget = '        ctx.save();\r\n        ctx.globalAlpha = opacity;';
const zoomNew = `        ctx.save();
        ctx.globalAlpha = opacity;

        // --- EFECTO ZOOM LATENTE PARA EL LIDER #1 ---
        if (this === currentTopArenaLeader || (roundRanking[0] && roundRanking[0].id === this.id)) {
            const zoomPulse = 1.0 + (Math.sin(Date.now() / 200) * 0.08); // Crece y decrece un 8%
            ctx.translate(this.x, this.y);
            ctx.scale(zoomPulse, zoomPulse);
            ctx.translate(-this.x, -this.y);
        }`;

if (code.includes(zoomTarget)) {
    code = code.replace(zoomTarget, zoomNew);
} else {
    // Intenta sin \r si es el caso
    const zoomTargetAlt = '        ctx.save();\n        ctx.globalAlpha = opacity;';
    if (code.includes(zoomTargetAlt)) {
        code = code.replace(zoomTargetAlt, zoomNew);
    } else {
        console.error("Zoom target not found!");
    }
}

// 2. Rediseño de victorias
const vicTarget = `        // Nombre (escala con el tamaño de la bola)
        const nameFontSize = Math.max(14, Math.floor(14 * sizeScale));
        ctx.fillStyle = "white";
        ctx.font = \`bold \${nameFontSize}px Rajdhani\`;
        ctx.textAlign = "center";
        
        // Racha de Victorias (Streak)
        const victories = Number(this.victories || (window.playerStreaks && window.playerStreaks[this.id]) || 0);
        let displayName = this.name || "Guerrero";
        if (victories > 1) {
            displayName = \`🔥x\${victories} \${displayName}\`;
            ctx.fillStyle = "#ffecd2";
        }
        
        // Corona grande para el líder
        if (this === currentTopArenaLeader || (roundRanking[0] && roundRanking[0].id === this.id)) {
            const crownSize = Math.max(22, Math.floor(22 * sizeScale));
            ctx.font = \`\${crownSize}px serif\`;
            ctx.fillText("👑", this.x, this.y - this.currentRadius - (12 * sizeScale) - crownSize * 0.6);
            ctx.font = \`bold \${nameFontSize}px Rajdhani\`;
        }
        
        ctx.shadowBlur = 5;
        ctx.shadowColor = "black";
        ctx.fillText(displayName, this.x, this.y - this.currentRadius - (12 * sizeScale));
        ctx.shadowBlur = 0;`;

const vicNew = `        // Nombre e Indicadores (escala con el tamaño de la bola)
        const sizeScale = this.currentRadius / PLAYER_RADIUS;
        const nameFontSize = Math.max(16, Math.floor(16 * sizeScale));
        
        // Racha de Victorias (Streak histórico/Rondas Ganadas)
        const victories = Number(this.victories || (window.playerStreaks && window.playerStreaks[this.id]) || 0);
        let displayName = this.name || "Guerrero";
        
        if (victories > 0) {
            const vicFontSize = Math.max(30, Math.floor(26 * sizeScale));
            const floatY = Math.sin(Date.now() / 300) * 8; // Flota suavemente
            ctx.fillStyle = "#FFC82C";
            ctx.font = \`bold \${vicFontSize}px Rajdhani\`;
            ctx.shadowColor = "black";
            ctx.shadowBlur = 10;
            // Dibuja trofeo grande que flota sobre la cabeza
            ctx.fillText(\`🏆 x\${victories}\`, this.x, this.y - this.currentRadius - (35 * sizeScale) - 25 + floatY);
            ctx.shadowBlur = 0;
            ctx.fillStyle = "#ffecd2"; // Nombre color dorado suave
        } else {
            ctx.fillStyle = "white"; 
        }
        
        // Corona gigante dorada para el líder
        if (this === currentTopArenaLeader || (roundRanking[0] && roundRanking[0].id === this.id)) {
            const crownSize = Math.max(32, Math.floor(32 * sizeScale));
            ctx.font = \`\${crownSize}px serif\`;
            ctx.fillText("👑", this.x, this.y - this.currentRadius - (victories > 0 ? (65 * sizeScale) : (18 * sizeScale)) - crownSize * 0.8);
            ctx.font = \`bold \${nameFontSize}px Rajdhani\`;
        }
        
        ctx.shadowBlur = 6;
        ctx.shadowColor = "black";
        ctx.font = \`bold \${nameFontSize}px Rajdhani\`;
        ctx.textAlign = "center";
        ctx.fillText(displayName, this.x, this.y - this.currentRadius - (12 * sizeScale));
        ctx.shadowBlur = 0;`;

if (code.includes(vicTarget.replace(/\r/g, ""))) {
    code = code.replace(vicTarget.replace(/\r/g, ""), vicNew);
} else if (code.includes(vicTarget)) {
    code = code.replace(vicTarget, vicNew);
} else {
    // Intento con búsqueda más relajada
    const startMarker = '        // Nombre (escala con el tamaño de la bola)';
    const endMarker = '        ctx.shadowBlur = 0;';
    const firstIdx = code.indexOf(startMarker);
    if (firstIdx !== -1) {
        const lastIdx = code.indexOf(endMarker, firstIdx) + endMarker.length;
        const targetSection = code.substring(firstIdx, lastIdx);
        code = code.replace(targetSection, vicNew);
    } else {
        console.error("Victories target not found!");
    }
}

fs.writeFileSync('arena.js', code);
console.log("Replaces done!");
