// physics-worker.js - Offloads collision detection and spatial grid updates
let spatialGrid = null;
let cellSize = 100;
let cols = 0;
let rows = 0;

function initGrid(width, height, size) {
    cellSize = size;
    cols = Math.ceil(width / cellSize);
    rows = Math.ceil(height / cellSize);
    spatialGrid = new Array(cols * rows);
}

function clearGrid() {
    for (let i = 0; i < spatialGrid.length; i++) {
        spatialGrid[i] = null;
    }
}

function insertIntoGrid(obj) {
    const x = Math.floor(obj.x / cellSize);
    const y = Math.floor(obj.y / cellSize);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const idx = y * cols + x;
    if (!spatialGrid[idx]) spatialGrid[idx] = [];
    spatialGrid[idx].push(obj);
}

function getNeighbors(obj) {
    const x = Math.floor(obj.x / cellSize);
    const y = Math.floor(obj.y / cellSize);
    const neighbors = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const nx = x + i;
            const ny = y + j;
            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                const idx = ny * cols + nx;
                const cell = spatialGrid[idx];
                if (cell) {
                    for (let k = 0; k < cell.length; k++) {
                        neighbors.push(cell[k]);
                    }
                }
            }
        }
    }
    return neighbors;
}

self.onmessage = function(e) {
    const { type, data } = e.data;

    if (type === 'init') {
        initGrid(data.width, data.height, data.cellSize);
    } else if (type === 'update') {
        const { players, isSuddenDeath } = data;
        const pList = Object.values(players);
        
        clearGrid();
        // Solo insertar jugadores activos
        for (let i = 0; i < pList.length; i++) {
            const p = pList[i];
            if (p.hp > 0 && p.opacity > 0.1) {
                insertIntoGrid(p);
            }
        }

        const collisions = [];
        const processedPairs = new Set();

        for (let i = 0; i < pList.length; i++) {
            const p1 = pList[i];
            if (p1.hp <= 0 || p1.opacity <= 0.1) continue;

            const neighbors = getNeighbors(p1);
            for (let j = 0; j < neighbors.length; j++) {
                const p2 = neighbors[j];
                if (p1.id === p2.id || p2.hp <= 0) continue;

                // Evitar doble check
                const pairId = p1.id < p2.id ? `${p1.id}-${p2.id}` : `${p2.id}-${p1.id}`;
                if (processedPairs.has(pairId)) continue;
                processedPairs.add(pairId);

                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const distSq = dx * dx + dy * dy;

                const p1HasSaw = p1.sawLife > 0 || p1.passiveSawTier > 0;
                const p2HasSaw = p2.sawLife > 0 || p2.passiveSawTier > 0;
                
                const bodyMinDist = p1.currentRadius + p2.currentRadius;
                const saw1Radius = p1.currentRadius + 15 + (p1.passiveSawTier * 12);
                const saw2Radius = p2.currentRadius + 15 + (p2.passiveSawTier * 12);
                const sawMinDist = saw1Radius + saw2Radius;

                if (distSq < bodyMinDist * bodyMinDist) {
                    collisions.push({
                        type: 'body',
                        p1Id: p1.id,
                        p2Id: p2.id,
                        dx, dy, distSq,
                        minDist: bodyMinDist
                    });
                } else if (p1HasSaw && p2HasSaw && distSq < sawMinDist * sawMinDist) {
                    collisions.push({
                        type: 'saw-clash',
                        p1Id: p1.id,
                        p2Id: p2.id,
                        dx, dy, distSq,
                        minDist: sawMinDist
                    });
                }
            }
        }

        self.postMessage({ type: 'collisions', collisions });
    }
};
