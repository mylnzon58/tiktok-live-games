const fs = require('fs');
let code = fs.readFileSync('arena.js', 'utf8');

code = code.replace(
    /\} else if \(giftEffect\.type === "projectile"\) \{\s*playSound\("roseShot"\);\s*const pColor = color \|\| \(data\.giftName\?\.toLowerCase\(\)\.includes\("rose"\) \? "#ff4757" : "#00f0ff"\);\s*spawnProjectileBurst\(attacker, target, Math\.min\(6, 1 \+ Math\.floor\(diamondsTotal\/2\)\), damage, pColor, \{[\s\S]*?atkType = "none"; \/\/ Ya manejado por burst/g,
    `} else if (giftEffect.type === "projectile") {
            const volMod = Math.min(3.5, 1 + (diamondsTotal / 50));
            if (diamondsTotal >= 1000) playSound("universeCrash", Math.min(3.0, volMod));
            else if (diamondsTotal >= 100) playSound("jackpot", Math.min(2.0, volMod));
            else if (diamondsTotal >= 10) playSound("powerUp", Math.min(1.5, volMod));
            else playSound("roseShot", volMod);

            const pColor = color || (data.giftName?.toLowerCase().includes("rose") ? "#ff4757" : "#00f0ff");
            spawnProjectileBurst(attacker, target, Math.min(20, 1 + Math.floor(diamondsTotal/2)), damage, pColor, {
                spread: 12 + Math.min(30, diamondsTotal * 0.15),
                speed: 16 + Math.min(20, diamondsTotal * 0.08),
                wobble: 10 + Math.min(15, diamondsTotal * 0.1),
                radius: 14 + Math.min(40, diamondsTotal * 0.8),
                trail: true 
            });
            
            if (diamondsTotal >= 10) {
                triggerOverlayFlash("255, 255, 255", Math.min(0.65, diamondsTotal / 300));
                screenShake = Math.max(screenShake, Math.min(60, 10 + diamondsTotal / 5));
                createExplosion(target.x, target.y, pColor, { count: Math.min(80, 20 + diamondsTotal), speed: 12, shake: 0 });
            }
            atkType = "none";`
);

code = code.replace(
    /\} else if \(data\.sfx\) \{\s*\/\/ Regalos de pago: volumen\/pitch según valor para dopamina \(pagos suenan más impactantes\)\s*const paidPitch = diamondsTotal >= 1000 \? 1\.15 : diamondsTotal >= 100 \? 1\.08 : 1\.0;\s*playSound\(data\.sfx, paidPitch\);\s*\}/g,
    `} else if (data.sfx) {
            const volMod = Math.min(4.0, 1 + (diamondsTotal / 50));
            // Regalos de pago: volumen brutal escalado dinámicamente según valor de diamantes
            const paidPitch = diamondsTotal >= 1000 ? 1.15 : diamondsTotal >= 100 ? 1.08 : 1.0;
            playSound(data.sfx, paidPitch * volMod);
        }`
);

fs.writeFileSync('arena.js', code);
console.log("Replaced");
