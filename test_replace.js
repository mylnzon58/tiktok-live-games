const fs = require('fs');
let code = fs.readFileSync('arena.js', 'utf8');
const startIdx = code.indexOf('ctx.rotate(this.sawAngle);');
const endIdx = code.indexOf('ctx.fill();\r\n            ctx.restore();', startIdx) + 11;
if (startIdx === -1 || (endIdx - 11) === -1) {
    console.error("Indexes not found!");
    process.exit(1);
}
const targetStr = code.substring(startIdx, endIdx);
const newStr = `ctx.rotate(this.sawAngle);
            const sawRadius = worldSawRadius;
            const isVipSaw = this.sawLife > 0;
            const teethCount = isVipSaw ? Math.max(16, Math.min(60, 20 + Math.floor(activityBoost * 2))) : Math.max(12, Math.min(48, 12 + Math.floor(activityBoost * 1.5) + (passiveSawTier * 4)));
            const toothDepth = isVipSaw ? 14 + (18 + activityBoost) * (0.6 + engagementFactor * 0.6) : 6 + (10 + activityBoost) * (0.5 + engagementFactor * 0.5);

            ctx.beginPath();
            for (let i = 0; i < teethCount; i++) {
                const a0 = (i / teethCount) * Math.PI * 2;
                const a1 = ((i + 0.35) / teethCount) * Math.PI * 2;
                const a2 = ((i + 0.5) / teethCount) * Math.PI * 2;
                const a3 = ((i + 1) / teethCount) * Math.PI * 2;
                const rBase = sawRadius;
                const rTip = sawRadius + toothDepth;

                if (i === 0) ctx.moveTo(Math.cos(a0) * rBase, Math.sin(a0) * rBase);
                else ctx.lineTo(Math.cos(a0) * rBase, Math.sin(a0) * rBase);

                if (isVipSaw) {
                    const attackCpAngle = (a0 + a1) / 2;
                    ctx.quadraticCurveTo(Math.cos(attackCpAngle) * (rBase + toothDepth * 0.6), Math.sin(attackCpAngle) * (rBase + toothDepth * 0.6), Math.cos(a1) * rTip, Math.sin(a1) * rTip);
                } else {
                    ctx.lineTo(Math.cos(a1) * rTip, Math.sin(a1) * rTip);
                }

                const cpAngle = (a1 + a2) / 2;
                const cpR = isVipSaw ? (rTip * 0.65) : (rTip * 0.88);
                ctx.quadraticCurveTo(Math.cos(cpAngle) * cpR, Math.sin(cpAngle) * cpR, Math.cos(a2) * (rBase + toothDepth * 0.15), Math.sin(a2) * (rBase + toothDepth * 0.15));
                ctx.lineTo(Math.cos(a3) * rBase, Math.sin(a3) * rBase);
            }
            ctx.closePath();

            const grad = ctx.createRadialGradient(0, 0, sawRadius, 0, 0, sawRadius + toothDepth);
            if (isVipSaw) {
                grad.addColorStop(0, 'rgba(9, 132, 227, 0.9)');
                grad.addColorStop(0.5, 'rgba(232, 67, 147, 0.9)');
                grad.addColorStop(1, 'rgba(255, 118, 117, 1)');
                ctx.lineWidth = 5;
            } else {
                grad.addColorStop(0, '#7f8fa6');
                grad.addColorStop(0.5, '#dcdde1');
                grad.addColorStop(1, '#353b48');
                ctx.lineWidth = 4;
            }
            ctx.strokeStyle = grad;
            ctx.stroke();
            if (isVipSaw) {
                ctx.fillStyle = 'rgba(45, 52, 54, 0.4)';
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#e84393';
            } else {
                ctx.fillStyle = 'rgba(235, 239, 245, 0.35)';
                ctx.shadowBlur = 0;
            }
            ctx.fill();`;
fs.writeFileSync('arena.js', code.replace(targetStr, newStr));
