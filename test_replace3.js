const fs = require('fs');
let code = fs.readFileSync('arena.js', 'utf8');

code = code.replace(
    /\} else if \(giftEffect\.type === "tapSpark"\) \{\s*playSound\("hit", 1\.2\);\s*createExplosion\(target\.x, target\.y, "#fef08a", \{ count: 12, speed: 6, shake: 2 \}\);/g,
    `} else if (giftEffect.type === "tapSpark") {
            const volMod = Math.min(3.0, 1 + (diamondsTotal / 50));
            playSound("hit", 1.2 * volMod);
            createExplosion(target.x, target.y, "#fef08a", { count: 12 + Math.min(40, diamondsTotal), speed: 6 + Math.min(10, diamondsTotal*0.1), shake: 2 + Math.min(15, diamondsTotal*0.2) });`
);

code = code.replace(
    /\} else if \(giftEffect\.type === "fireBurst"\) \{\s*playSound\(data\.sfx \|\| "fire"\);\s*createFireBurst\(target\.x, target\.y, attacker\.currentRadius \+ 64\);\s*createExplosion\(target\.x, target\.y, "#ff8a00", \{ count: 42, speed: 13, shake: 14 \}\);\s*createExplosion\(target\.x \+ 26, target\.y - 20, "#ffd166", \{ count: 26, speed: 9, shake: 8 \}\);/g,
    `} else if (giftEffect.type === "fireBurst") {
            const volMod = Math.min(3.5, 1 + (diamondsTotal / 50));
            playSound(data.sfx || "fire", volMod);
            createFireBurst(target.x, target.y, attacker.currentRadius + 64 + Math.min(60, diamondsTotal));
            createExplosion(target.x, target.y, "#ff8a00", { count: 42 + Math.min(50, diamondsTotal), speed: 13 + Math.min(10, diamondsTotal*0.1), shake: 14 + Math.min(10, diamondsTotal*0.1) });
            createExplosion(target.x + 26, target.y - 20, "#ffd166", { count: 26 + Math.min(30, diamondsTotal), speed: 9, shake: 8 });`
);

code = code.replace(
    /\} else if \(giftEffect\.type === "shockwave"\) \{\s*playSound\(data\.sfx \|\| "heavyExplosion"\);\s*hitStopFrames = Math\.max\(hitStopFrames, 12\);\s*focusCamera\(target\.x, target\.y, Math\.max\(fxProfile\.cameraScale, 1\.38\), Math\.max\(fxProfile\.cameraFrames, 95\)\);\s*createExplosion\(target\.x, target\.y, color, \{ count: 44, speed: 14, shake: 18 \}\);/g,
    `} else if (giftEffect.type === "shockwave") {
            const volMod = Math.min(3.5, 1 + (diamondsTotal / 50));
            playSound(data.sfx || "heavyExplosion", volMod);
            hitStopFrames = Math.max(hitStopFrames, 12 + Math.min(20, Math.floor(diamondsTotal/10)));
            focusCamera(target.x, target.y, Math.max(fxProfile.cameraScale, 1.38 + Math.min(0.5, diamondsTotal/500)), Math.max(fxProfile.cameraFrames, 95 + Math.min(50, diamondsTotal/10)));
            createExplosion(target.x, target.y, color, { count: 44 + Math.min(60, diamondsTotal), speed: 14 + Math.min(10, diamondsTotal*0.1), shake: 18 + Math.min(20, diamondsTotal*0.1) });`
);

fs.writeFileSync('arena.js', code);
console.log("Replaced");
