const fs = require('fs');
const path = 'arena.js';
let code = fs.readFileSync(path, 'utf8');

// Constantes L
const L_X = 645;
const L_Y = 530;

// 1. getArenaBounds
const boundsOld = `function getArenaBounds() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // Ahora rectangular: Ocupa casi todo el ancho y alto libre
    const width = 740; // Deja margen lateral
    const height = 1100; // Deja espacio para el header y footer widgets
    return {
        cx, cy,
        width, height,
        left: cx - width / 2,
        right: cx + width / 2,
        top: cy - height / 2 + 60, // Bajamos un poco por el header nuevo
        bottom: cy + height / 2
    };
}`;

const boundsNew = `function getArenaBounds() {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const width = 770; 
    const height = 1200; 
    return {
        cx, cy, width, height,
        left: cx - width / 2,
        right: cx + width / 2,
        top: 80,
        bottom: canvas.height - 85
    };
}`;

code = code.replace(boundsOld, boundsNew);
if (!code.includes('top: 80,')) {
    code = code.replace(boundsOld.replace(/\r/g, ''), boundsNew);
}

// 2. clampToArena
const clampOld = `function clampToArena(x, y, margin = 20) {
    const b = getArenaBounds();
    return {
        x: Math.max(b.left + margin, Math.min(b.right - margin, x)),
        y: Math.max(b.top + margin, Math.min(b.bottom - margin, y))
    };
}`;

const clampNew = `function clampToArena(x, y, margin = 20) {
    const b = getArenaBounds();
    let rBound = b.right - margin;
    if (y < 530) rBound = Math.min(rBound, 645 - margin);
    return {
        x: Math.max(b.left + margin, Math.min(rBound, x)),
        y: Math.max(b.top + margin, Math.min(b.bottom - margin, y))
    };
}`;

code = code.replace(clampOld, clampNew);
if (!code.includes('if (y < 530)')) {
    code = code.replace(clampOld.replace(/\r/g, ''), clampNew);
}

// 3. Draw border L
const drawOld = `    ctx.strokeStyle = gradient;
    ctx.strokeRect(arenaB.left, arenaB.top, arenaB.width, arenaB.height);`;

const drawNew = `    ctx.strokeStyle = gradient;
    // Dibujo en L
    ctx.beginPath();
    ctx.moveTo(arenaB.left, arenaB.top);
    ctx.lineTo(645, arenaB.top);
    ctx.lineTo(645, 530);
    ctx.lineTo(arenaB.right, 530);
    ctx.lineTo(arenaB.right, arenaB.bottom);
    ctx.lineTo(arenaB.left, arenaB.bottom);
    ctx.closePath();
    ctx.stroke();`;

code = code.replace(drawOld, drawNew);
if (!code.includes('// Dibujo en L')) {
    code = code.replace(drawOld.replace(/\r/g, ''), drawNew);
}

// 4. Update Bounce Logic
const bounceOld = `        if (this.x + this.currentRadius > right) {
            this.x = right - this.currentRadius;
            this.vx = -Math.abs(this.vx);
            bounced = true;
        } else if (this.x - this.currentRadius < left) {`;

const bounceNew = `        let curRight = right;
        if (this.y < 530) curRight = Math.min(curRight, 645);

        if (this.x + this.currentRadius > curRight) {
            this.x = curRight - this.currentRadius;
            this.vx = -Math.abs(this.vx);
            bounced = true;
        } else if (this.x - this.currentRadius < left) {`;

code = code.replace(bounceOld, bounceNew);
if (!code.includes('let curRight = right;')) {
    code = code.replace(bounceOld.replace(/\r/g, ''), bounceNew);
}

// Bounce extra para el fondo del panel (el techo de la extension L)
const bounceExtraOld = `        if (this.y + this.currentRadius > bottom) {
            this.y = bottom - this.currentRadius;
            this.vy = -Math.abs(this.vy);
            bounced = true;
        } else if (this.y - this.currentRadius < top) {`;

const bounceExtraNew = `        if (this.y + this.currentRadius > bottom) {
            this.y = bottom - this.currentRadius;
            this.vy = -Math.abs(this.vy);
            bounced = true;
        } else if (this.y - this.currentRadius < top) {
            this.y = top + this.currentRadius;
            this.vy = Math.abs(this.vy);
            bounced = true;
        }
        
        // Bloqueo horizontal del panel (techo de la extensión L)
        if (this.y - this.currentRadius < 530 && this.x + this.currentRadius > 645 && this.vy < 0) {
             this.y = 530 + this.currentRadius;
             this.vy = Math.abs(this.vy);
             bounced = true;
        }`;

code = code.replace(bounceExtraOld, bounceExtraNew);

fs.writeFileSync(path, code);
console.log("Arena L shape implemented!");
