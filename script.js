/**
 * JOJO BIZARRE BATTLE - ENGINE CORE
 * ---------------------------------
 * Architecture:
 * - Fixed Frame Loop (60FPS approx)
 * - Midpoint Camera Translation
 * - Projectile Lifecycle Management
 * - Character Archetypes (Melee / Ranged)
 * - 50+ Characters from Parts 3-9
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const charGrid = document.getElementById('char-grid');
const tsOverlay = document.getElementById('time-stop-overlay');

canvas.width = 1200;
canvas.height = 650;

// GLOBAL CONSTANTS
const WORLD_WIDTH = 3400;
const WORLD_HEIGHT = canvas.height;
const GRAVITY = 0.75;
const GROUND_Y = WORLD_HEIGHT - 60;
const INITIAL_SP = 50;
const SP_PER_HIT = 18;
const DAMAGE_REDUCTION_FACTOR = 0.65;

const camera = {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    follow(p1, p2) {
        const midX = (p1.x + p1.w / 2 + p2.x + p2.w / 2) / 2;
        let targetX = midX - this.width / 2;
        if (targetX < 0) targetX = 0;
        if (targetX > WORLD_WIDTH - this.width) targetX = WORLD_WIDTH - this.width;
        this.x += (targetX - this.x) * 0.12;
    }
};

let timeStopped = false;
let timeStopperId = null;

// ── SOUND MANAGER ───────────────────────────────────────────
const SoundManager = {
    sounds: {},
    unlocked: false,

    // Call this on first user interaction to unlock audio context
    unlock() {
        if (this.unlocked) return;
        this.unlocked = true;
        // Play and immediately pause every sound to warm them up
        Object.values(this.sounds).forEach(s => {
            s.audio.play().then(() => {
                s.audio.pause();
                s.audio.currentTime = 0;
            }).catch(() => {});
        });
    },

    load(key, src, duration) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        audio.volume = 1.0;
        this.sounds[key] = { audio, duration };
    },

    play(key) {
        const s = this.sounds[key];
        if (!s) { console.warn('Sound not found:', key); return; }
        s.audio.pause();
        s.audio.currentTime = 0;
        const playPromise = s.audio.play();
        if (playPromise) {
            playPromise.catch(err => console.warn('Sound play failed:', key, err));
        }
        if (s.duration) {
            setTimeout(() => {
                s.audio.pause();
                s.audio.currentTime = 0;
            }, s.duration * 1000);
        }
    }
};

// Preload all stand sounds
SoundManager.load('timestop',     'sounds/TIMESTOP.mp3',     2);
SoundManager.load('diotimestop',  'sounds/DIOTIMESTOP.mp3',  4);
SoundManager.load('kingcrimson',  'sounds/KINGCRIMSON.mp3',  1);
SoundManager.load('crazydiamond','sounds/CRAZYDIAMOND.mp3',  4);
SoundManager.load('killerqueen', 'sounds/KILLERQUEEN.mp3',   4);

// Unlock audio on first click/keypress anywhere
document.addEventListener('click', () => SoundManager.unlock(), { once: true });
document.addEventListener('keydown', () => SoundManager.unlock(), { once: true });


let gameMode = 'pvp';       // 'pvp' or 'cpu'
let aiDifficulty = 'medium'; // 'easy', 'medium', 'hard'
let aiController = null;

// ── STAGES ──────────────────────────────────────────────────
let selectedStage = null;

const STAGES = [
    {
        id: 'cairo',
        name: 'Cairo',
        part: 3,
        partColor: '#f1c40f',
        sky: ['#0a0a2e', '#1a1a4e'],        // deep night blue
        groundColor: '#c8a96e',
        groundTop: '#e8c98e',
        draw(ctx, W, H, G) { drawCairo(ctx, W, H, G); }
    },
    {
        id: 'morioh4',
        name: 'Morioh',
        part: 4,
        partColor: '#8e44ad',
        sky: ['#87CEEB', '#b0e0ff'],
        groundColor: '#5a7a3a',
        groundTop: '#7aaa4a',
        draw(ctx, W, H, G) { drawMorioh(ctx, W, H, G); }
    },
    {
        id: 'naples',
        name: 'Naples',
        part: 5,
        partColor: '#e74c3c',
        sky: ['#ff6b35', '#ff9f55'],
        groundColor: '#8B7355',
        groundTop: '#a08060',
        draw(ctx, W, H, G) { drawNaples(ctx, W, H, G); }
    },
    {
        id: 'prison',
        name: 'Green Dolphin',
        part: 6,
        partColor: '#1abc9c',
        sky: ['#1a3a5c', '#2a5a8c'],
        groundColor: '#4a4a4a',
        groundTop: '#5a5a5a',
        draw(ctx, W, H, G) { drawPrison(ctx, W, H, G); }
    },
    {
        id: 'plains',
        name: 'American Plains',
        part: 7,
        partColor: '#e67e22',
        sky: ['#87CEEB', '#c8eeff'],
        groundColor: '#8B6914',
        groundTop: '#c8a040',
        draw(ctx, W, H, G) { drawPlains(ctx, W, H, G); }
    },
    {
        id: 'morioh8',
        name: 'Morioh (JJL)',
        part: 8,
        partColor: '#3498db',
        sky: ['#ffd6e8', '#ffe8f0'],
        groundColor: '#5a6a4a',
        groundTop: '#7a9a6a',
        draw(ctx, W, H, G) { drawMoriohJJL(ctx, W, H, G); }
    },
    {
        id: 'hawaii',
        name: 'Hawaii',
        part: 9,
        partColor: '#9b59b6',
        sky: ['#00b4d8', '#48cae4'],
        groundColor: '#c8a96e',
        groundTop: '#e8c98e',
        draw(ctx, W, H, G) { drawHawaii(ctx, W, H, G); }
    },
];

// ── STAGE DRAWING FUNCTIONS ──────────────────────────────────

function drawSky(ctx, W, H, colors) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
}

function drawStars(ctx, W, count) {
    ctx.fillStyle = 'white';
    for (let i = 0; i < count; i++) {
        const sx = (i * 337) % W;
        const sy = (i * 179) % 220;
        const ss = i % 3 === 0 ? 2 : 1;
        ctx.fillRect(sx, sy, ss, ss);
    }
}

function drawClouds(ctx, W, color, y, count) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
        const cx = (i * (W / count)) + 80;
        const cy = y + (i % 3) * 20;
        const r = 28 + (i % 3) * 12;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + r * 0.7, cy + 5, r * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx - r * 0.6, cy + 8, r * 0.6, 0, Math.PI * 2); ctx.fill();
    }
}

// Part 3 — Cairo night desert
function drawCairo(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#0a0a2e', '#1a1a4e']);
    drawStars(ctx, W, 80);
    // Moon
    ctx.fillStyle = '#fffde0';
    ctx.beginPath(); ctx.arc(W - 250, 80, 45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a4e';
    ctx.beginPath(); ctx.arc(W - 233, 72, 40, 0, Math.PI * 2); ctx.fill();
    // Pyramids
    const pyramids = [[600,G,220], [1000,G,170], [1400,G,200], [2100,G,180], [2600,G,150], [3000,G,190]];
    pyramids.forEach(([px,py,ps]) => {
        ctx.fillStyle = '#c8a45a';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - ps, py); ctx.lineTo(px - ps/2, py - ps * 0.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#a07840';
        ctx.beginPath(); ctx.moveTo(px - ps/2, py - ps*0.7); ctx.lineTo(px, py); ctx.lineTo(px - ps/2 + 30, py); ctx.closePath(); ctx.fill();
    });
    // Sand dunes
    ctx.fillStyle = '#c8a96e';
    for (let d = 0; d < W; d += 300) {
        ctx.beginPath(); ctx.arc(d + 150, G + 10, 180, Math.PI, 0); ctx.fill();
    }
    // Ground
    ctx.fillStyle = '#c8a96e';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#e8c98e';
    ctx.fillRect(0, G, W, 10);
}

// Part 4 — Morioh town daytime
function drawMorioh(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#87CEEB', '#b0e0ff']);
    drawClouds(ctx, W, 'rgba(255,255,255,0.85)', 60, 6);
    // Sun
    ctx.fillStyle = '#fff176';
    ctx.beginPath(); ctx.arc(200, 90, 50, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffee58';
    ctx.beginPath(); ctx.arc(200, 90, 38, 0, Math.PI * 2); ctx.fill();
    // Houses
    const houses = [
        [120,G,80,100,'#e8d5b0','#c0392b'],
        [320,G,100,130,'#d4c5a0','#8B4513'],
        [600,G,70,90,'#f0e0c0','#e74c3c'],
        [850,G,90,110,'#ddd0b0','#c0392b'],
        [1100,G,75,100,'#e8d5b0','#8B4513'],
        [1380,G,95,120,'#d4c5a0','#e74c3c'],
        [1650,G,80,100,'#f0e0c0','#c0392b'],
        [1900,G,100,130,'#e0d0a0','#8B4513'],
        [2200,G,70,90,'#e8d5b0','#e74c3c'],
        [2500,G,90,110,'#d4c5a0','#c0392b'],
        [2750,G,80,100,'#f0e0c0','#8B4513'],
        [3000,G,95,115,'#e0d0a0','#e74c3c'],
    ];
    houses.forEach(([hx,hy,hw,hh,wall,roof]) => {
        ctx.fillStyle = wall;
        ctx.fillRect(hx - hw/2, hy - hh, hw, hh);
        ctx.fillStyle = roof;
        ctx.beginPath(); ctx.moveTo(hx - hw/2 - 8, hy - hh); ctx.lineTo(hx, hy - hh - hw*0.5); ctx.lineTo(hx + hw/2 + 8, hy - hh); ctx.closePath(); ctx.fill();
        // Window
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(hx - 12, hy - hh + 20, 22, 18);
        ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
        ctx.strokeRect(hx - 12, hy - hh + 20, 22, 18);
    });
    // Road
    ctx.fillStyle = '#888';
    ctx.fillRect(0, G - 4, W, 4);
    // Grass
    ctx.fillStyle = '#5a7a3a';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#7aaa4a';
    ctx.fillRect(0, G, W, 8);
}

// Part 5 — Naples sunset
function drawNaples(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#ff4500', '#ff9f55']);
    // Sun on horizon
    ctx.fillStyle = '#fff176';
    ctx.beginPath(); ctx.arc(W/2, G + 20, 70, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,50,0.3)';
    ctx.beginPath(); ctx.arc(W/2, G + 20, 120, Math.PI, 0); ctx.fill();
    // Italian buildings
    const blds = [
        [80,G,90,180,'#e8c89a'],  [250,G,70,220,'#ddb870'],
        [420,G,100,160,'#e0c090'], [620,G,80,200,'#c8a870'],
        [820,G,110,180,'#ddc088'], [1050,G,75,210,'#e8c890'],
        [1280,G,95,170,'#d4b878'], [1500,G,85,190,'#e0c080'],
        [1720,G,100,160,'#c8b070'],[1950,G,70,220,'#ddc080'],
        [2180,G,90,180,'#e8c88a'],[2400,G,80,200,'#d4b870'],
        [2650,G,105,175,'#ddc090'],[2900,G,75,210,'#e0c078'],
        [3150,G,90,185,'#c8b068'],
    ];
    blds.forEach(([bx,by,bw,bh,col]) => {
        ctx.fillStyle = col;
        ctx.fillRect(bx - bw/2, by - bh, bw, bh);
        // Flat roof detail
        ctx.fillStyle = '#a08858';
        ctx.fillRect(bx - bw/2 - 4, by - bh, bw + 8, 8);
        // Windows
        ctx.fillStyle = '#ffcc44';
        for (let wy = by - bh + 20; wy < by - 20; wy += 35) {
            ctx.fillRect(bx - bw/2 + 8, wy, 14, 18);
            if (bw > 75) ctx.fillRect(bx + 8, wy, 14, 18);
        }
    });
    // Cobblestone ground
    ctx.fillStyle = '#8B7355';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#a08060';
    ctx.fillRect(0, G, W, 10);
    ctx.strokeStyle = '#7a6040'; ctx.lineWidth = 1;
    for (let cx = 0; cx < W; cx += 40) {
        ctx.beginPath(); ctx.moveTo(cx, G); ctx.lineTo(cx, G + 30); ctx.stroke();
    }
}

// Part 6 — Green Dolphin Prison
function drawPrison(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#1a3a5c', '#2a5a8c']);
    drawStars(ctx, W, 40);
    // Ocean horizon
    const oceanGrad = ctx.createLinearGradient(0, G - 120, 0, G);
    oceanGrad.addColorStop(0, '#1a4a8c');
    oceanGrad.addColorStop(1, '#0d2a5c');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, G - 120, W, 120);
    // Ocean waves
    ctx.strokeStyle = 'rgba(100,160,255,0.4)'; ctx.lineWidth = 2;
    for (let wx = 0; wx < W; wx += 120) {
        ctx.beginPath(); ctx.arc(wx + 60, G - 20, 60, Math.PI, 0); ctx.stroke();
    }
    // Prison walls & towers
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(0, G - 160, W, 160);
    // Wall top battlements
    ctx.fillStyle = '#4a4a4a';
    for (let tx = 0; tx < W; tx += 60) {
        ctx.fillRect(tx, G - 185, 35, 30);
    }
    // Watchtowers
    [150, 600, 1100, 1700, 2300, 2800, 3200].forEach(tx => {
        ctx.fillStyle = '#404040';
        ctx.fillRect(tx - 35, G - 260, 70, 105);
        ctx.fillStyle = '#383838';
        ctx.fillRect(tx - 45, G - 275, 90, 18);
        // Tower light
        ctx.fillStyle = 'rgba(255,255,100,0.6)';
        ctx.beginPath(); ctx.arc(tx, G - 268, 10, 0, Math.PI * 2); ctx.fill();
        // Searchlight beam
        ctx.fillStyle = 'rgba(255,255,150,0.08)';
        ctx.beginPath(); ctx.moveTo(tx, G - 268); ctx.lineTo(tx - 200, G - 160); ctx.lineTo(tx + 200, G - 160); ctx.closePath(); ctx.fill();
        // Barred window
        ctx.fillStyle = '#222';
        ctx.fillRect(tx - 12, G - 220, 24, 30);
        ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
        for (let bar = tx - 8; bar < tx + 14; bar += 8) {
            ctx.beginPath(); ctx.moveTo(bar, G - 220); ctx.lineTo(bar, G - 190); ctx.stroke();
        }
    });
    // Concrete ground
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(0, G, W, 8);
    // Concrete cracks
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1;
    for (let crk = 0; crk < W; crk += 200) {
        ctx.beginPath(); ctx.moveTo(crk + 50, G); ctx.lineTo(crk + 80, G + 25); ctx.stroke();
    }
}

// Part 7 — American Plains
function drawPlains(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#87CEEB', '#c8eeff']);
    drawClouds(ctx, W, 'rgba(255,255,255,0.9)', 50, 5);
    // Distant mountains
    ctx.fillStyle = '#8aaabb';
    const mtns = [[200,G-80,300],[700,G-110,380],[1300,G-90,320],[1900,G-100,350],[2600,G-85,300],[3100,G-95,330]];
    mtns.forEach(([mx,my,ms]) => {
        ctx.beginPath(); ctx.moveTo(mx-ms/2,G-5); ctx.lineTo(mx,my); ctx.lineTo(mx+ms/2,G-5); ctx.closePath(); ctx.fill();
        // Snow cap
        ctx.fillStyle = 'white';
        ctx.beginPath(); ctx.moveTo(mx-30,my+35); ctx.lineTo(mx,my); ctx.lineTo(mx+30,my+35); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#8aaabb';
    });
    // Distant trees
    ctx.fillStyle = '#2d6a2d';
    for (let t = 0; t < W; t += 180) {
        ctx.fillRect(t + 60, G - 70, 12, 50);
        ctx.beginPath(); ctx.arc(t + 66, G - 80, 25, 0, Math.PI * 2); ctx.fill();
    }
    // Fence posts
    ctx.fillStyle = '#8B6914';
    for (let f = 0; f < W; f += 120) {
        ctx.fillRect(f + 10, G - 35, 8, 35);
        ctx.fillRect(f + 10, G - 35, 100, 5);
        ctx.fillRect(f + 10, G - 22, 100, 5);
    }
    // Dirt ground
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#c8a040';
    ctx.fillRect(0, G, W, 10);
    // Tire track lines
    ctx.strokeStyle = '#7a5808'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, G + 20); ctx.lineTo(W, G + 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, G + 40); ctx.lineTo(W, G + 40); ctx.stroke();
}

// Part 8 — Morioh JoJolion (cherry blossom spring)
function drawMoriohJJL(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#ffd6e8', '#ffe8f0']);
    // Cherry blossom petals drifting (static positions)
    ctx.fillStyle = 'rgba(255,182,193,0.7)';
    for (let p = 0; p < 60; p++) {
        const px = (p * 487) % W;
        const py = (p * 293) % (G - 50);
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }
    // Wall of Roses / TG University wall
    ctx.fillStyle = '#d4c4b0';
    ctx.fillRect(0, G - 130, W, 130);
    // Wall detail - brickwork
    ctx.strokeStyle = '#c0b0a0'; ctx.lineWidth = 1;
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < W; col += 80) {
            const offset = (row % 2) * 40;
            ctx.strokeRect(col + offset - 40, G - 130 + row * 26, 78, 24);
        }
    }
    // Cherry blossom trees
    const trees = [100, 400, 750, 1150, 1550, 1950, 2350, 2750, 3100];
    trees.forEach(tx => {
        // Trunk
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(tx - 8, G - 220, 16, 100);
        // Branch left/right
        ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(tx, G - 180); ctx.lineTo(tx - 55, G - 230); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(tx, G - 180); ctx.lineTo(tx + 55, G - 230); ctx.stroke();
        // Blossom clouds
        ctx.fillStyle = 'rgba(255,182,193,0.85)';
        [[0,-30,40],[-50,-20,32],[50,-20,32],[-30,-55,28],[30,-55,28]].forEach(([ox,oy,r]) => {
            ctx.beginPath(); ctx.arc(tx + ox, G - 210 + oy, r, 0, Math.PI * 2); ctx.fill();
        });
    });
    // Pavement
    ctx.fillStyle = '#8a9a7a';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#aaba9a';
    ctx.fillRect(0, G, W, 8);
    // Pavement tiles
    ctx.strokeStyle = '#7a8a6a'; ctx.lineWidth = 1;
    for (let tile = 0; tile < W; tile += 50) {
        ctx.beginPath(); ctx.moveTo(tile, G); ctx.lineTo(tile, G + 30); ctx.stroke();
    }
}

// Part 9 — Hawaii beach
function drawHawaii(ctx, W, H, G) {
    drawSky(ctx, W, H, ['#00b4d8', '#48cae4']);
    drawClouds(ctx, W, 'rgba(255,255,255,0.8)', 40, 4);
    // Sun
    ctx.fillStyle = '#fff9c4';
    ctx.beginPath(); ctx.arc(300, 100, 60, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff176';
    ctx.beginPath(); ctx.arc(300, 100, 44, 0, Math.PI * 2); ctx.fill();
    // Ocean
    const oceanGrad = ctx.createLinearGradient(0, G - 100, 0, G);
    oceanGrad.addColorStop(0, '#0077b6');
    oceanGrad.addColorStop(1, '#00b4d8');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, G - 100, W, 100);
    // Wave foam
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
    for (let wx = 0; wx < W; wx += 200) {
        ctx.beginPath(); ctx.arc(wx + 100, G - 15, 100, Math.PI, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(wx, G - 8, 60, Math.PI, 0); ctx.stroke();
    }
    // Palm trees
    const palms = [200, 700, 1300, 1900, 2500, 3050];
    palms.forEach(px => {
        // Trunk (slightly leaning)
        ctx.strokeStyle = '#8B5E3C'; ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(px, G); ctx.quadraticCurveTo(px + 20, G - 100, px + 35, G - 200); ctx.stroke();
        // Coconuts
        ctx.fillStyle = '#5d4037';
        [[0,0],[15,-10],[-10,-8]].forEach(([ox,oy]) => {
            ctx.beginPath(); ctx.arc(px + 35 + ox, G - 200 + oy, 8, 0, Math.PI * 2); ctx.fill();
        });
        // Palm leaves
        ctx.fillStyle = '#2d6a1a';
        [[-80,-30],[-50,-70],[0,-90],[50,-70],[80,-30],[60,10],[-60,10]].forEach(([lx,ly]) => {
            ctx.beginPath();
            ctx.moveTo(px + 35, G - 200);
            ctx.quadraticCurveTo(px + 35 + lx/2, G - 200 + ly/2 - 15, px + 35 + lx, G - 200 + ly);
            ctx.lineWidth = 8; ctx.strokeStyle = '#2d6a1a'; ctx.stroke();
        });
    });
    // Sandy beach
    ctx.fillStyle = '#c8a96e';
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = '#e8c98e';
    ctx.fillRect(0, G, W, 10);
    // Sand texture dots
    ctx.fillStyle = 'rgba(180,150,80,0.4)';
    for (let sd = 0; sd < 120; sd++) {
        ctx.beginPath(); ctx.arc((sd * 337) % W, G + 5 + (sd * 7) % 25, 2, 0, Math.PI * 2); ctx.fill();
    }
}


// ============================================================
// CHARACTER ROSTER - Parts 3 through 9
// ============================================================
const CHARACTERS = [
    // ─── PART 3: Stardust Crusaders ───────────────────────────
    {
        name: "Jotaro", part: 3, color: "#2c3e50", hp: 220, speed: 6.2, dmg: 16,
        type: "melee", specialType: "timestop", duration: 1800, sound: "timestop",
        desc: "Star Platinum: ORA Rush + Time Stop"
        // Normal: close-range Stand punch barrage
        // Special: stops time, unleashes rush of ORA punches
    },
    {
        name: "Dio", part: 3, color: "#f1c40f", hp: 180, speed: 7, dmg: 14,
        type: "ranged", projectile: "knife", specialType: "timestop", duration: 4000, sound: "diotimestop",
        desc: "The World: Knife Throw + Massive Time Stop"
        // Normal: throws knives (Dio's iconic knife throw)
        // Special: ZA WARUDO 4-second freeze, MUDA rush during stop
    },
    {
        name: "Kakyoin", part: 3, color: "#27ae60", hp: 160, speed: 6.5, dmg: 10,
        type: "ranged", projectile: "emerald", specialType: "emerald_splash",
        desc: "Hierophant Green: Emerald Splash Volley"
        // Normal: shoots emerald splashes in a line
        // Special: fires wide spread of emeralds in all directions
    },
    {
        name: "Polnareff", part: 3, color: "#c0c0c0", hp: 185, speed: 6.8, dmg: 15,
        type: "melee", specialType: "armor_off",
        desc: "Silver Chariot: Rapier Thrust Combo + Armor Off"
        // Normal: rapid rapier thrusts (Silver Chariot's signature)
        // Special: removes armor for ultra-fast flurry of 6 stabs
    },
    {
        name: "Avdol", part: 3, color: "#e74c3c", hp: 175, speed: 5.8, dmg: 13,
        type: "ranged", projectile: "flame", specialType: "crossfire",
        desc: "Magician's Red: Flame Whip + Crossfire Hurricane"
        // Normal: fires a flame projectile (heat whip)
        // Special: Crossfire Hurricane — X-shaped flame burst from both directions
    },
    {
        name: "Iggy", part: 3, color: "#7f8c8d", hp: 130, speed: 8.5, dmg: 9,
        type: "ranged", projectile: "sand", specialType: "sand_clone",
        desc: "The Fool: Sand Razors + Sand Clone Bait"
        // Normal: fires razor-sharp sand shards
        // Special: creates a sand decoy that draws the opponent in, then teleports Iggy behind
    },
    {
        name: "Joseph", part: 3, color: "#e67e22", hp: 190, speed: 6.5, dmg: 12,
        type: "ranged", projectile: "clacker", specialType: "hermit_vine",
        desc: "Hermit Purple: Clacker Volley + Vine Snare"
        // Normal: hurls clacker balls (Joseph's signature weapon)
        // Special: shoots Hermit Purple vines that wrap and stun the opponent
    },
    {
        name: "Rubber Soul", part: 3, color: "#2ecc71", hp: 155, speed: 7.2, dmg: 11,
        type: "melee", specialType: "absorb",
        desc: "Yellow Temperance: Slime Grab + Absorb Armor"
        // Normal: grabs with Yellow Temperance acidic slime, melee range
        // Special: absorbs a hit completely and regenerates HP (Yellow Temperance eats attacks)
    },
    {
        name: "Hol Horse", part: 3, color: "#d4a017", hp: 150, speed: 7.0, dmg: 9,
        type: "ranged", projectile: "bullet", specialType: "guided_bullet",
        desc: "Emperor: Revolver Shot + Guided Bullet Curve"
        // Normal: fires Emperor revolver bullets (his actual gun Stand)
        // Special: fires a bullet that curves mid-air to chase the opponent
    },
    {
        name: "N'Doul", part: 3, color: "#1a6bb5", hp: 160, speed: 6.0, dmg: 14,
        type: "ranged", projectile: "water", specialType: "geb_slash",
        desc: "Geb: Water Claw + Invisible Slash Strike"
        // Normal: Geb water claw that travels along the ground
        // Special: blindsiding slash — stuns and deals high damage from unexpected angle
    },
    {
        name: "Mariah", part: 3, color: "#ff6b9d", hp: 145, speed: 7.5, dmg: 8,
        type: "melee", specialType: "metal_crush",
        desc: "Bastet: Outlet Touch Magnetize + Metal Crush"
        // Normal: touches opponent to magnetize them (melee contact)
        // Special: magnetized opponent gets crushed by flying metal objects for big damage
    },
    {
        name: "Vanilla Ice", part: 3, color: "#8e44ad", hp: 200, speed: 6.5, dmg: 19,
        type: "melee", specialType: "void_charge",
        desc: "Cream: Void Orb + Annihilation Charge"
        // Normal: Cream's void sphere rolls forward erasing everything
        // Special: Vanilla Ice hides inside Cream and charges through opponent, massive damage
    },

    // ─── PART 4: Diamond is Unbreakable ──────────────────────
    {
        name: "Josuke", part: 4, color: "#8e44ad", hp: 200, speed: 6, dmg: 15,
        type: "melee", specialType: "crazy_heal", sound: "crazydiamond",
        desc: "Crazy Diamond: Shatter Punch + Restoration Heal"
        // Normal: Crazy Diamond punches that shatter on impact
        // Special: restores own HP AND launches restored shards as projectiles at enemy
    },
    {
        name: "Kira", part: 4, color: "#d2dae2", hp: 160, speed: 6, dmg: 22,
        type: "melee", specialType: "sheer_heart", sound: "killerqueen",
        desc: "Killer Queen: Touch Bomb + Sheer Heart Attack"
        // Normal: KQ punches that prime a contact bomb on the opponent
        // Special: deploys Sheer Heart Attack — a homing tank bomb that chases the opponent
    },
    {
        name: "Okuyasu", part: 4, color: "#3498db", hp: 210, speed: 5.8, dmg: 17,
        type: "melee", specialType: "right_hand_erase",
        desc: "The Hand: Swipe Punch + Space Erasure Pull"
        // Normal: The Hand right-arm swipe, huge melee range
        // Special: erases space between them, teleporting opponent right next to Okuyasu for a free hit
    },
    {
        name: "Rohan", part: 4, color: "#1dd1a1", hp: 150, speed: 7.5, dmg: 8,
        type: "melee", specialType: "heavens_door",
        desc: "Heaven's Door: Book Slap + Script Lock"
        // Normal: Heaven's Door slaps opponent, turning them into a book briefly (stun)
        // Special: fully opens opponent as a book — writes "cannot attack" locking them for 3s
    },
    {
        name: "Koichi", part: 4, color: "#a29bfe", hp: 145, speed: 7.0, dmg: 10,
        type: "melee", specialType: "act3_gravity",
        desc: "Echoes Act 3: Sound Stamp + S-H-O-K Gravity"
        // Normal: stamps a sound effect on opponent (Act 2 SFX hit, close range)
        // Special: Act 3 SHOK stamp — opponent becomes enormously heavy, crashes into floor
    },
    {
        name: "Yukako", part: 4, color: "#6c5ce7", hp: 155, speed: 6.5, dmg: 11,
        type: "ranged", projectile: "hair", specialType: "hair_cocoon",
        desc: "Love Deluxe: Hair Whip + Cocoon Bind"
        // Normal: lashes out with prehensile hair strands
        // Special: wraps opponent in a full hair cocoon, immobilizing and crushing them
    },
    {
        name: "Shigechi", part: 4, color: "#fdcb6e", hp: 140, speed: 5.5, dmg: 9,
        type: "ranged", projectile: "harvest_swarm", specialType: "harvest_retrieve",
        desc: "Harvest: Bug Swarm Sting + Mass Retrieve Attack"
        // Normal: sends a swarm of tiny Harvest stands to sting at range
        // Special: Harvest swarm converges from all directions at once — multi-hit
    },
    {
        name: "Hazamada", part: 4, color: "#74b9ff", hp: 140, speed: 6.0, dmg: 10,
        type: "melee", specialType: "puppet_control",
        desc: "Surface: Dummy Mimic + Puppet Control Strike"
        // Normal: Surface dummy mimics and punches
        // Special: Surface mimics the opponent exactly, confusing them and landing a counter punch
    },
    {
        name: "Yoshihiro", part: 4, color: "#e17055", hp: 100, speed: 9.0, dmg: 7,
        type: "ranged", projectile: "arrow", specialType: "ghost_arrow",
        desc: "Ghost: Stand Arrow Stab + Imbue Burst"
        // Normal: throws the Stand Arrow as a projectile
        // Special: stabs the arrow upward, raining arrow fragments down on opponent
    },
    {
        name: "Mikitaka", part: 4, color: "#00cec9", hp: 150, speed: 8.0, dmg: 10,
        type: "melee", specialType: "object_transform",
        desc: "Earth Wind & Fire: Shape-Shift Ambush + Object Form"
        // Normal: melee hit while in semi-transformed state
        // Special: transforms into a wheel/object and slams through the opponent at speed
    },

    // ─── PART 5: Golden Wind ──────────────────────────────────
    {
        name: "Giorno", part: 5, color: "#ff9ff3", hp: 190, speed: 6.5, dmg: 12,
        type: "melee", specialType: "life_giver",
        desc: "Gold Experience: Life Punch + Life Overdose Counter"
        // Normal: GE punch that turns part of the opponent into a living creature briefly
        // Special: Gold Experience Requiem counter — any damage dealt to Giorno gets amplified back
    },
    {
        name: "Bruno", part: 5, color: "#f5f6fa", hp: 170, speed: 7, dmg: 13,
        type: "melee", specialType: "zipper_port",
        desc: "Sticky Fingers: Corkscrew Punch + Zipper Warp"
        // Normal: ARI ARI corkscrew punch with Stand fists
        // Special: zips a portal behind the opponent, teleports through it for a back-attack
    },
    {
        name: "Mista", part: 5, color: "#2e86de", hp: 170, speed: 6.8, dmg: 11,
        type: "ranged", projectile: "bullet", specialType: "sex_pistols_redirect",
        desc: "Sex Pistols: Gunshot + Pistols Redirect Burst"
        // Normal: fires revolver shot (Mista uses an actual gun)
        // Special: Sex Pistols redirect 6 bullets simultaneously at the opponent from all angles
    },
    {
        name: "Abbacchio", part: 5, color: "#6c5ce7", hp: 175, speed: 6.0, dmg: 14,
        type: "melee", specialType: "moody_replay",
        desc: "Moody Blues: Stand Punch + Replay Trap"
        // Normal: Moody Blues replicated Stand punch (copies opponent's form)
        // Special: Moody Blues replays the opponent's last 10 seconds — they re-take all damage dealt
    },
    {
        name: "Narancia", part: 5, color: "#e84393", hp: 155, speed: 7.2, dmg: 10,
        type: "ranged", projectile: "aerosmith_bullet", specialType: "volare_via",
        desc: "Aerosmith: Plane Machine Gun + Volare Via Bomb Drop"
        // Normal: Aerosmith toy plane strafes with machine gun
        // Special: Volare Via — Aerosmith drops bombs in a line across the stage
    },
    {
        name: "Fugo", part: 5, color: "#a8e063", hp: 160, speed: 6.5, dmg: 16,
        type: "melee", specialType: "haze_release",
        desc: "Purple Haze: Capsule Fist + Virus Cloud Release"
        // Normal: Purple Haze punches — capsules on knuckles shatter on contact
        // Special: deliberately breaks all capsules creating a large virus cloud around Fugo
    },
    {
        name: "Trish", part: 5, color: "#fd79a8", hp: 150, speed: 7.5, dmg: 9,
        type: "melee", specialType: "spice_soften",
        desc: "Spice Girl: Soften Punch + Phase Absorption"
        // Normal: Spice Girl strikes while softening objects (fists phase through and burst)
        // Special: softens the ground under opponent, sinking them, then launches upward
    },
    {
        name: "Diavolo", part: 5, color: "#eb4d4b", hp: 180, speed: 7.2, dmg: 18,
        type: "melee", specialType: "time_erase", sound: "kingcrimson",
        desc: "King Crimson: Epitaph Predict + Time Erase Strike"
        // Normal: King Crimson uppercut — sees the future and strikes before opponent can react
        // Special: erases time completely, skips to after the opponent has taken damage with no memory
    },
    {
        name: "Risotto", part: 5, color: "#636e72", hp: 185, speed: 6.5, dmg: 15,
        type: "ranged", projectile: "iron_shard", specialType: "iron_extraction",
        desc: "Metallica: Iron Razor + Extract Iron From Blood"
        // Normal: fires iron shards extracted from the air at the opponent
        // Special: extracts iron from opponent's blood — forms razor blades and scissors INSIDE them
    },
    {
        name: "Prosciutto", part: 5, color: "#b2bec3", hp: 165, speed: 6.5, dmg: 12,
        type: "melee", specialType: "aging_aura",
        desc: "Grateful Dead: Age Touch + Aging Aura Surge"
        // Normal: touches opponent, accelerating their aging (slows them down)
        // Special: full aura release — rapidly ages opponent, massively slowing them for 5 seconds
    },
    {
        name: "Pesci", part: 5, color: "#55efc4", hp: 160, speed: 6.0, dmg: 13,
        type: "ranged", projectile: "fishhook", specialType: "reel_slam",
        desc: "Beach Boy: Hook Cast + Reel-In Ground Slam"
        // Normal: casts Beach Boy fishing line as a projectile hook
        // Special: hooks the opponent through surfaces, reels them in and body-slams them
    },
    {
        name: "Cioccolata", part: 5, color: "#2d3436", hp: 170, speed: 6.0, dmg: 14,
        type: "ranged", projectile: "mold_spore", specialType: "mold_surge",
        desc: "Green Day: Mold Spread + High Ground Surge"
        // Normal: releases Green Day mold spores that travel forward
        // Special: mold surges from the ground beneath the opponent, dealing damage over time
    },

    // ─── PART 6: Stone Ocean ─────────────────────────────────
    {
        name: "Jolyne", part: 6, color: "#10ac84", hp: 180, speed: 7, dmg: 12,
        type: "ranged", projectile: "string", specialType: "string_snare",
        desc: "Stone Free: String Lash + Snare & Shatter"
        // Normal: whips string as a ranged lash attack
        // Special: wraps opponent in string, pulls tight and shatters for high damage
    },
    {
        name: "Pucci", part: 6, color: "#5f27cd", hp: 160, speed: 9.5, dmg: 11,
        type: "melee", specialType: "heaven_acceleration",
        desc: "Made in Heaven: Stand Punch + Universe Acceleration"
        // Normal: fast MiH stand punch (Pucci is extremely fast)
        // Special: accelerates time universally — Pucci moves at insane speed, opponent barely moves for 4s
    },
    {
        name: "Ermes", part: 6, color: "#e55039", hp: 175, speed: 6.8, dmg: 13,
        type: "melee", specialType: "kiss_double",
        desc: "Kiss: Stand Punch + Sticker Duplicate"
        // Normal: Kiss stand punches (straightforward brawler)
        // Special: slaps a sticker on opponent — creates a duplicate that deals double the next hit's damage
    },
    {
        name: "Weather Report", part: 6, color: "#0984e3", hp: 180, speed: 6.5, dmg: 11,
        type: "ranged", projectile: "lightning_bolt", specialType: "heavy_weather",
        desc: "Weather Report: Lightning + Snail Heavy Weather"
        // Normal: calls down a lightning bolt from above
        // Special: Heavy Weather rainbow — opponent sees snails and takes massive damage over time
    },
    {
        name: "Anasui", part: 6, color: "#fd79a8", hp: 165, speed: 6.5, dmg: 15,
        type: "melee", specialType: "diver_bomb",
        desc: "Diver Down: Phase-In Punch + Internal Bomb"
        // Normal: Diver Down sinks into opponent and punches from inside
        // Special: stores a spring inside opponent — releases it violently for massive launch
    },
    {
        name: "F.F.", part: 6, color: "#81ecec", hp: 155, speed: 7.2, dmg: 9,
        type: "ranged", projectile: "plankton_shot", specialType: "ff_scatter",
        desc: "Foo Fighters: Plankton Shot + Body Scatter Burst"
        // Normal: fires condensed plankton projectiles
        // Special: F.F. body scatters into plankton cloud surrounding opponent, hits from all sides
    },
    {
        name: "Sports Maxx", part: 6, color: "#636e72", hp: 155, speed: 6.5, dmg: 11,
        type: "melee", specialType: "zombie_summon",
        desc: "Limp Bizkit: Revive Punch + Invisible Zombie Horde"
        // Normal: Stand melee punch that reanimates things briefly
        // Special: summons invisible zombies that attack the opponent unpredictably
    },
    {
        name: "Whitesnake", part: 6, color: "#dfe6e9", hp: 170, speed: 6.8, dmg: 13,
        type: "ranged", projectile: "disc", specialType: "disc_extract",
        desc: "Whitesnake: DISC Throw + Stand/Memory Extract"
        // Normal: throws a Stand DISC as a projectile
        // Special: extracts one of the opponent's DISCs — opponent loses speed temporarily
    },

    // ─── PART 7: Steel Ball Run ───────────────────────────────
    {
        name: "Johnny", part: 7, color: "#54a0ff", hp: 150, speed: 5.5, dmg: 24,
        type: "ranged", projectile: "spinning_nail", specialType: "tusk_act4",
        desc: "Tusk: Nail Shot + Act 4 Infinite Rotation"
        // Normal: fires a rotating nail shot (Tusk Act 1-3 style)
        // Special: Act 4 Infinite Rotation — nail locks onto opponent and drills through, unstoppable
    },
    {
        name: "Gyro", part: 7, color: "#ee5253", hp: 180, speed: 6, dmg: 16,
        type: "ranged", projectile: "steelball", specialType: "golden_spin",
        desc: "Ball Breaker: Steel Ball Throw + Golden Spin Explosion"
        // Normal: throws a steel ball with spin (bounces off walls/floor)
        // Special: Ball Breaker — golden spin steel ball that explodes on impact, huge AoE
    },
    {
        name: "Valentine", part: 7, color: "#0652DD", hp: 200, speed: 6.5, dmg: 15,
        type: "melee", specialType: "d4c_shift",
        desc: "D4C: Love Train + Dimension Hop Counter"
        // Normal: summons a parallel universe Valentine to punch simultaneously
        // Special: Love Train — warps into another dimension, all damage redirected away for 3s
    },
    {
        name: "Diego", part: 7, color: "#009432", hp: 175, speed: 7.8, dmg: 14,
        type: "melee", specialType: "dino_rush",
        desc: "Scary Monsters: Raptor Claw + Dino Rush & Alt Timestop"
        // Normal: transforms arm into raptor claw for a fast slash
        // Special: full raptor charge — rushes opponent, then briefly stops time (alt World)
    },
    {
        name: "Wekapipo", part: 7, color: "#dff9fb", hp: 160, speed: 6.5, dmg: 12,
        type: "ranged", projectile: "wrecking_ball", specialType: "paralysis_field",
        desc: "Wrecking Ball: Steel Ball Throw + Left Side Paralysis"
        // Normal: throws Wrecking Ball steel balls that ricochet
        // Special: precise left-side hit — paralyzes the left half of opponent's body
    },
    {
        name: "Sandman", part: 7, color: "#e58e26", hp: 165, speed: 8.5, dmg: 11,
        type: "ranged", projectile: "sand_blade", specialType: "sound_run",
        desc: "In a Silent Way: Sand Blade + Sound Sprint Blitz"
        // Normal: fires razor sand blades by running (his Stand activates via sprinting)
        // Special: stores sound energy while dashing, releases as a devastating shockwave
    },
    {
        name: "Pocoloco", part: 7, color: "#f9ca24", hp: 155, speed: 7.5, dmg: 10,
        type: "melee", specialType: "hey_ya_luck",
        desc: "Hey Ya!: Lucky Punch + Fortune Mega Strike"
        // Normal: melee punch guided by Hey Ya's fortune advice
        // Special: Hey Ya predicts the perfect moment — lands a critical that deals 2.5x damage
    },

    // ─── PART 8: JoJolion ────────────────────────────────────
    {
        name: "Josuke 8", part: 8, color: "#48dbfb", hp: 170, speed: 6.5, dmg: 12,
        type: "ranged", projectile: "bubble", specialType: "plunder_bubble",
        desc: "Soft & Wet: Bubble Shot + Plunder Attribute"
        // Normal: fires Soft & Wet bubbles that pop on contact
        // Special: large bubble that plunders opponent's speed stat (their movement halved)
    },
    {
        name: "Norisuke IV", part: 8, color: "#ffa502", hp: 165, speed: 6.0, dmg: 11,
        type: "melee", specialType: "scent_fragment",
        desc: "King Nothing: Scent Track + Fragment Rip"
        // Normal: grabs and rips at opponent (King Nothing follows scent trails to limbs)
        // Special: rips off a fragment of the opponent and uses it to track and home-strike them
    },
    {
        name: "Yasuho", part: 8, color: "#eccc68", hp: 140, speed: 7.5, dmg: 8,
        type: "ranged", projectile: "paisley_vine", specialType: "reroute",
        desc: "Paisley Park: Vine Guide + Reroute Damage"
        // Normal: Paisley Park vines reach out and grab/trip opponent
        // Special: reroutes the next attack's damage back at the attacker (navigation reversal)
    },
    {
        name: "Dolomite", part: 8, color: "#b2bec3", hp: 160, speed: 6.5, dmg: 12,
        type: "melee", specialType: "body_hijack",
        desc: "Blue Hawaii: Water Bite + Remote Body Control"
        // Normal: Blue Hawaii bites via water contact
        // Special: hijacks opponent's body — forces them to walk toward a hazard/wall and slam
    },
    {
        name: "Jobin", part: 8, color: "#fd9644", hp: 175, speed: 6.8, dmg: 14,
        type: "melee", specialType: "fever_burst",
        desc: "Speed King: Heat Store + Fever Burst Release"
        // Normal: Speed King punch that stores heat in the opponent on contact
        // Special: triggers all stored heat at once — opponent takes massive burn damage
    },
    {
        name: "Rai", part: 8, color: "#a29bfe", hp: 155, speed: 7.5, dmg: 11,
        type: "melee", specialType: "surface_flatten",
        desc: "Doggy Style: Flatten Ambush + Lucky Surface Slide"
        // Normal: Doggy Style flattens into surfaces for a surprise melee hit
        // Special: slides through the floor and pops up right under opponent for a launch
    },
    {
        name: "Wonder of U", part: 8, color: "#2d3436", hp: 190, speed: 5.0, dmg: 18,
        type: "ranged", projectile: "calamity_bolt", specialType: "pursuit_calamity",
        desc: "Wonder of U: Calamity Bolt + Pursuit Curse"
        // Normal: fires a bolt of calamity that triggers accidents on hit
        // Special: activates full Pursuit — anyone who tries to attack Wonder of U takes calamity damage
    },
    {
        name: "Ojiro", part: 8, color: "#ff6b81", hp: 145, speed: 8.0, dmg: 13,
        type: "melee", specialType: "limb_extend",
        desc: "Awaking III Leaves: Extend Strike + Telescoping Grab"
        // Normal: extends arm for a long-range melee strike
        // Special: massively extends all limbs at once, surrounding opponent and squeezing
    },

    // ─── PART 9: The JOJOLands ────────────────────────────────
    {
        name: "Jodio", part: 9, color: "#1289A7", hp: 165, speed: 7.0, dmg: 12,
        type: "ranged", projectile: "raindrop", specialType: "november_downpour",
        desc: "November Rain: Raindrop Shot + Pressurized Downpour"
        // Normal: fires a single high-pressure raindrop (like a bullet)
        // Special: summons a concentrated downpour — 8 rapid raindrops pelt the opponent
    },
    {
        name: "Dragona", part: 9, color: "#C4E538", hp: 155, speed: 7.8, dmg: 11,
        type: "melee", specialType: "skin_slip",
        desc: "Smooth Operators: Slip Punch + Skin Repositioning"
        // Normal: Smooth Operators melee hit while shifting skin position
        // Special: repositions own skin to phase through a hit, then counterstrikes from behind
    },
    {
        name: "Paco", part: 9, color: "#ED4C67", hp: 200, speed: 5.8, dmg: 16,
        type: "melee", specialType: "hustle_transfer",
        desc: "The Hustle: Heavy Punch + Injury Transfer"
        // Normal: raw heavy Stand punch (The Hustle is a pure brawler)
        // Special: transfers all damage Paco has taken back onto the opponent
    },
    {
        name: "HOWLER", part: 9, color: "#F79F1F", hp: 170, speed: 7.0, dmg: 13,
        type: "ranged", projectile: "sound_wave", specialType: "sonic_boom",
        desc: "HOWLER: Sonic Pulse + Concussive Boom"
        // Normal: fires a sonic wave projectile
        // Special: full sonic boom — expands in both directions, stuns and launches opponent
    },
    {
        name: "Meryl", part: 9, color: "#9980FA", hp: 150, speed: 7.5, dmg: 10,
        type: "ranged", projectile: "music_note", specialType: "do_re_mi_trap",
        desc: "Doremifasolati Do: Note Shot + Scale Mine Trap"
        // Normal: fires musical note projectiles
        // Special: plants do-re-mi scale mines across the ground that detonate when walked over
    },
    // ─── ???: SECRET ─────────────────────────────────────────
    {
        name: "???",
        part: 0,
        color: "#ff0000",
        hp: 999,
        speed: 12,
        dmg: 60,
        type: "melee",
        specialType: "glitch_nuke",
        secret: true,
        desc: "UNKNOWN: ████████████████████████"
    },
];

let p1Data, p2Data, player1, player2;
let projectiles = [];
let gameRunning = false;
let selectingPlayer = 1;
const keys = {};

// ============================================================
// CHARACTER SELECTION UI
// ============================================================
const PART_LABELS = {
    3: "Part 3: Stardust Crusaders",
    4: "Part 4: Diamond is Unbreakable",
    5: "Part 5: Golden Wind",
    6: "Part 6: Stone Ocean",
    7: "Part 7: Steel Ball Run",
    8: "Part 8: JoJolion",
    9: "Part 9: The JOJOLands"
};

const PART_COLORS = {
    3: "#f1c40f",
    4: "#8e44ad",
    5: "#e74c3c",
    6: "#1abc9c",
    7: "#e67e22",
    8: "#3498db",
    9: "#9b59b6"
};

// Group chars by part and build grid with headers
let currentPart = null;
CHARACTERS.filter(c => !c.secret).forEach((char, i) => {
    const realIdx = CHARACTERS.indexOf(char);
    if (char.part !== currentPart) {
        currentPart = char.part;
        const header = document.createElement('div');
        header.className = 'part-header';
        header.style.color = PART_COLORS[char.part];
        header.style.borderColor = PART_COLORS[char.part];
        header.innerText = PART_LABELS[char.part];
        charGrid.appendChild(header);
    }
    const card = document.createElement('div');
    card.className = 'char-card';
    card.style.borderColor = '#333';
    card.innerHTML = `
        <div class="char-part-tag" style="color:${PART_COLORS[char.part]}">Part ${char.part}</div>
        <div class="char-name" style="color:${char.color}">${char.name}</div>
        <div class="char-desc">${char.desc}</div>
    `;
    card.onclick = () => selectChar(realIdx, card);
    charGrid.appendChild(card);
});

// Build stage select cards (mini canvas previews)
function buildStageSelect() {
    const grid = document.getElementById('stage-grid');
    grid.innerHTML = '';
    STAGES.forEach((stage, i) => {
        const card = document.createElement('div');
        card.className = 'stage-card';

        // Mini preview canvas
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 320;
        previewCanvas.height = 180;
        const pc = previewCanvas.getContext('2d');
        // Draw a mini version of the stage
        stage.draw(pc, 320, 180, 140);
        card.appendChild(previewCanvas);

        // Label
        const label = document.createElement('div');
        label.className = 'stage-card-label';
        label.innerHTML = `
            <div class="stage-card-part" style="color:${stage.partColor}">PART ${stage.part}</div>
            <div class="stage-card-name" style="color:${stage.partColor}">${stage.name}</div>
        `;
        card.appendChild(label);
        card.onclick = () => pickStage(i);
        grid.appendChild(card);
    });
}
buildStageSelect();

function pickStage(idx) {
    selectedStage = STAGES[idx];
    document.getElementById('stage-select').style.display = 'none';
    initGame();
}

// Secret character — press X during character select to instantly pick ???
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyX') {
        const secretChar = CHARACTERS.find(c => c.secret);
        if (!secretChar) return;
        const overlay = document.getElementById('char-select');
        if (overlay.style.display === 'none' || overlay.style.display === '') return;
        if (selectingPlayer === 1) {
            p1Data = secretChar;
            if (gameMode === 'cpu') {
                p2Data = CHARACTERS.filter(c => !c.secret)[Math.floor(Math.random() * (CHARACTERS.length - 1))];
                setTimeout(showStageSelect, 200);
            } else {
                selectingPlayer = 2;
                document.getElementById('selection-msg').innerText = "Player 2: Select Character";
                document.getElementById('selection-msg').style.color = 'var(--jojo-red)';
            }
        } else {
            p2Data = secretChar;
            setTimeout(showStageSelect, 200);
        }
    }
});

function selectMode(mode) {
    gameMode = mode;
    document.getElementById('mode-select').style.display = 'none';
    if (mode === 'cpu') {
        document.getElementById('difficulty-select').style.display = 'flex';
    } else {
        // PvP — go straight to char select
        document.getElementById('char-select').style.display = 'flex';
        document.getElementById('controls-p2-hint').style.display = '';
    }
}

function selectDifficulty(diff) {
    aiDifficulty = diff;
    document.getElementById('difficulty-select').style.display = 'none';
    document.getElementById('char-select').style.display = 'flex';
    document.getElementById('selection-msg').innerText = "Player 1: Select Your Character";
    document.getElementById('controls-p2-hint').style.display = 'none';
}

function selectChar(idx, el) {
    if (selectingPlayer === 1) {
        p1Data = CHARACTERS[idx];
        el.classList.add('selected-p1');

        if (gameMode === 'cpu') {
            // Pick a random character for the AI
            p2Data = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
            setTimeout(showStageSelect, 400);
        } else {
            selectingPlayer = 2;
            document.getElementById('selection-msg').innerText = "Player 2: Select Character";
            document.getElementById('selection-msg').style.color = 'var(--jojo-red)';
        }
    } else {
        p2Data = CHARACTERS[idx];
        el.classList.add('selected-p2');
        setTimeout(showStageSelect, 400);
    }
}

function showStageSelect() {
    document.getElementById('char-select').style.display = 'none';
    document.getElementById('stage-select').style.display = 'flex';
}

// ============================================================
// PLAYER CLASS
// ============================================================
class Player {
    constructor(id, x, data, controls) {
        this.id = id;
        this.x = x;
        this.y = GROUND_Y - 110;
        this.w = 55;
        this.h = 120;
        this.data = data;
        this.controls = controls;
        this.hp = data.hp;
        this.sp = INITIAL_SP;
        this.vx = 0; this.vy = 0;
        this.facing = id === 1 ? 1 : -1;
        this.isJumping = false;
        this.isAttacking = false;
        this.attackCD = 0;
        this.hitFlash = 0;
        this.invul = 0;
        this.stunned = 0;
        this.speedMod = 1;
        this.meleeBox = { w: 90, h: 60 };
    }

    update(opponent) {
        if (this.hitFlash > 0) this.hitFlash--;
        if (this.invul > 0) this.invul--;
        if (this.attackCD > 0) this.attackCD--;
        if (this.stunned > 0) { this.stunned--; return; }

        if (!timeStopped || timeStopperId === this.id) {
            if (keys[this.controls.left]) this.vx = -this.data.speed * this.speedMod;
            else if (keys[this.controls.right]) this.vx = this.data.speed * this.speedMod;
            else this.vx = 0;

            if (keys[this.controls.up] && !this.isJumping) {
                this.vy = -19;
                this.isJumping = true;
            }

            if (keys[this.controls.attack] && this.attackCD <= 0) {
                this.data.type === "melee" ? this.meleeAttack(opponent) : this.rangedAttack(opponent);
            }

            if (keys[this.controls.special] && this.sp >= 100) this.useSpecial(opponent);
        } else this.vx = 0;

        if (this.vx !== 0) this.facing = this.vx > 0 ? 1 : -1;

        this.vy += GRAVITY;
        this.x += this.vx;
        this.y += this.vy;
        if (this.y + this.h > GROUND_Y) { this.y = GROUND_Y - this.h; this.vy = 0; this.isJumping = false; }
        if (this.x < 0) this.x = 0;
        if (this.x + this.w > WORLD_WIDTH) this.x = WORLD_WIDTH - this.w;
    }

    meleeAttack(opp) {
        this.isAttacking = true;
        this.attackCD = 22;
        const hitX = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
        const hitY = this.y + 30;
        if (this.checkCollision(hitX, hitY, this.meleeBox.w, this.meleeBox.h, opp)) {
            opp.takeDamage(this.data.dmg * DAMAGE_REDUCTION_FACTOR, this.facing);
            this.gainSP(SP_PER_HIT);
        }
        setTimeout(() => this.isAttacking = false, 150);
    }

    rangedAttack(opp) {
        this.isAttacking = true;
        this.attackCD = 28;
        const pX = this.facing === 1 ? this.x + this.w : this.x - 20;
        const pY = this.y + 45;
        projectiles.push(new Projectile(pX, pY, this.facing, this.id, this.data.dmg * DAMAGE_REDUCTION_FACTOR, this.data.projectile));
        setTimeout(() => this.isAttacking = false, 150);
    }

    useSpecial(opp) {
        this.sp = 0;
        if (this.data.sound) SoundManager.play(this.data.sound);
        const sType = this.data.specialType;

        switch (sType) {

            // ── PART 3 ────────────────────────────────────────────
            case "timestop":
                // Jotaro: ORA rush during time stop
                timeStopped = true; timeStopperId = this.id;
                tsOverlay.style.display = 'block';
                tsOverlay.style.background = 'rgba(80,80,255,0.15)';
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; }, this.data.duration);
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                        if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp))
                            opp.takeDamage(this.data.dmg * 0.45, this.facing);
                    }, i * 110);
                }
                break;

            case "timestop_knives":
                // Dio: stop time, throw knives, then MUDA rush
                timeStopped = true; timeStopperId = this.id;
                tsOverlay.style.display = 'block';
                tsOverlay.style.background = 'rgba(255,220,0,0.12)';
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(this.x, this.y + 20 + i * 15, this.facing, this.id, this.data.dmg * 0.5, "knife"));
                    }, i * 80);
                }
                setTimeout(() => {
                    for (let i = 0; i < 4; i++) {
                        setTimeout(() => {
                            const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                            if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp))
                                opp.takeDamage(this.data.dmg * 0.5, this.facing);
                        }, i * 120);
                    }
                }, 600);
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; }, this.data.duration);
                break;

            case "emerald_splash":
                // Kakyoin: wide spread of emeralds in all directions
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const p = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 0.7, "emerald");
                        p.vy = (i - 3.5) * 2.5;
                        p.vx = this.facing * (12 + Math.random() * 4);
                        projectiles.push(p);
                    }, i * 40);
                }
                break;

            case "armor_off":
                // Polnareff: removes armor for ultra-fast 6-stab flurry
                this.speedMod = 1.5;
                this.invul = 20;
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                        if (this.checkCollision(hx, this.y + 15, this.meleeBox.w, this.meleeBox.h, opp))
                            opp.takeDamage(this.data.dmg * 0.55, this.facing);
                    }, i * 70);
                }
                setTimeout(() => this.speedMod = 1, 1500);
                break;

            case "crossfire":
                // Avdol: X-shaped flames from both directions
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(this.x, this.y + 40 + i * 10, this.facing, this.id, this.data.dmg * 0.8, "flame"));
                        projectiles.push(new Projectile(this.x, this.y + 40 + i * 10, -this.facing, this.id, this.data.dmg * 0.8, "flame"));
                    }, i * 100);
                }
                break;

            case "sand_clone":
                // Iggy: sand clone decoy, teleports behind opponent
                this.invul = 90;
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x - this.facing * 60));
                opp.stunned = 50;
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                break;

            case "hermit_vine":
                // Joseph: Hermit Purple vines stun and pull
                opp.stunned = 120;
                opp.speedMod = 0.3;
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(this.x, this.y + 40, this.facing, this.id, this.data.dmg * 0.6, "clacker"));
                    }, i * 100);
                }
                setTimeout(() => opp.speedMod = 1, 3000);
                break;

            case "absorb":
                // Rubber Soul / Yellow Temperance: absorbs damage and heals
                this.hp = Math.min(this.data.hp, this.hp + this.data.hp * 0.3);
                this.invul = 100;
                opp.takeDamage(this.data.dmg * 0.8, this.facing);
                break;

            case "guided_bullet":
                // Hol Horse: bullet curves mid-air to track opponent
                {
                    const gb = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 1.6, "bullet");
                    gb.guided = true;
                    gb.guidedTarget = opp;
                    gb.w = 12; gb.h = 12;
                    projectiles.push(gb);
                }
                break;

            case "geb_slash":
                // N'Doul: blindside slash from unexpected angle
                opp.stunned = 100;
                opp.takeDamage(this.data.dmg * 1.8, this.facing);
                break;

            case "metal_crush":
                // Mariah: magnetized opponent crushed by metal objects
                opp.speedMod = 0.1;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 2.2, this.facing);
                    opp.vy = -8;
                    opp.speedMod = 1;
                }, 800);
                break;

            case "void_charge":
                // Vanilla Ice: hides in Cream void, charges through
                this.invul = 80;
                this.x += this.facing * 280;
                opp.takeDamage(this.data.dmg * 2.0, this.facing);
                opp.vy = -12;
                break;

            // ── PART 4 ────────────────────────────────────────────
            case "crazy_heal":
                // Josuke: heals self AND fires shards at enemy
                this.hp = Math.min(this.data.hp, this.hp + this.data.hp * 0.35);
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        const p = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 0.6, "shard");
                        p.vy = (i - 1.5) * 3;
                        projectiles.push(p);
                    }, i * 80);
                }
                break;

            case "sheer_heart":
                // Kira: deploy Sheer Heart Attack homing bomb
                {
                    const sha = new Projectile(this.x, this.y + this.h - 20, this.facing, this.id, this.data.dmg * 1.8, "bomb_tank");
                    sha.isHoming = true;
                    sha.homingTarget = opp;
                    sha.vx = this.facing * 5;
                    sha.w = 24; sha.h = 20;
                    projectiles.push(sha);
                }
                break;

            case "right_hand_erase":
                // Okuyasu: erases space, snaps opponent right next to him
                opp.x = this.x + this.facing * 65;
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                opp.stunned = 40;
                break;

            case "heavens_door":
                // Rohan: writes "cannot attack" in opponent — long stun
                opp.stunned = 220;
                opp.takeDamage(this.data.dmg * 0.5, this.facing);
                break;

            case "act3_gravity":
                // Koichi: SHOK stamp — opponent crashes into floor
                opp.vy = 25;
                opp.stunned = 80;
                opp.takeDamage(this.data.dmg * 1.3, this.facing);
                break;

            case "hair_cocoon":
                // Yukako: full hair wrap, crush
                opp.stunned = 140;
                opp.speedMod = 0;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.7, this.facing);
                    opp.speedMod = 1;
                }, 700);
                break;

            case "harvest_retrieve":
                // Shigechi: Harvest converge from all directions
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const dir = i % 2 === 0 ? 1 : -1;
                        const p = new Projectile(opp.x + dir * 300, opp.y + Math.random() * 80, -dir, this.id, this.data.dmg * 0.5, "harvest_swarm");
                        p.vx = -dir * 10;
                        projectiles.push(p);
                    }, i * 60);
                }
                break;

            case "puppet_control":
                // Hazamada: Surface mimics opponent, counter punch
                this.invul = 60;
                setTimeout(() => {
                    const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                    if (this.checkCollision(hx, this.y + 20, this.meleeBox.w + 30, this.meleeBox.h, opp))
                        opp.takeDamage(this.data.dmg * 2.0, this.facing);
                }, 300);
                break;

            case "ghost_arrow":
                // Yoshihiro: arrow fragments rain down on opponent
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const ax = opp.x + (Math.random() - 0.5) * 80;
                        const ap = new Projectile(ax, 0, 0, this.id, this.data.dmg * 0.7, "arrow");
                        ap.vx = 0; ap.vy = 16;
                        projectiles.push(ap);
                    }, i * 120);
                }
                break;

            case "object_transform":
                // Mikitaka: transforms into wheel, slams through
                this.speedMod = 3.0;
                this.invul = 70;
                setTimeout(() => {
                    const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                    if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp)) {
                        opp.takeDamage(this.data.dmg * 1.8, this.facing);
                        opp.vy = -14;
                    }
                }, 400);
                setTimeout(() => this.speedMod = 1, 1000);
                break;

            // ── PART 5 ────────────────────────────────────────────
            case "life_giver":
                // Giorno: GER counter — amplifies damage back
                this.invul = 100;
                this.hp = Math.min(this.data.hp, this.hp + 25);
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                opp.stunned = 60;
                break;

            case "zipper_port":
                // Bruno: zips portal behind opponent, back-attack
                this.invul = 50;
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x + this.facing * 70));
                this.facing = -this.facing;
                setTimeout(() => {
                    const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                    if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp))
                        opp.takeDamage(this.data.dmg * 1.8, this.facing);
                }, 200);
                break;

            case "sex_pistols_redirect":
                // Mista: 6 bullets from all angles
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        const dirs = [1, -1, 1, -1, 1, -1];
                        const p = new Projectile(opp.x + dirs[i] * 250, opp.y + i * 15, -dirs[i], this.id, this.data.dmg * 0.7, "bullet");
                        p.vx = -dirs[i] * 14;
                        projectiles.push(p);
                    }, i * 80);
                }
                break;

            case "moody_replay":
                // Abbacchio: opponent re-takes damage from last 10 seconds
                opp.takeDamage(this.data.dmg * 1.6, this.facing);
                opp.stunned = 80;
                this.hp = Math.min(this.data.hp, this.hp + 20);
                break;

            case "volare_via":
                // Narancia: Aerosmith drops bombs in a line
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        const bx = this.x + this.facing * (80 + i * 70);
                        const bomb = new Projectile(bx, 0, 0, this.id, this.data.dmg * 0.9, "aerosmith_bullet");
                        bomb.vx = 0; bomb.vy = 18;
                        projectiles.push(bomb);
                    }, i * 120);
                }
                break;

            case "haze_release":
                // Fugo: virus cloud around Fugo, anyone nearby takes damage
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        opp.speedMod = 0.4;
                        const hx = this.facing === 1 ? this.x - 80 : this.x - 80;
                        if (this.checkCollision(hx, this.y - 40, 220, 200, opp))
                            opp.takeDamage(this.data.dmg * 0.6, this.facing);
                    }, i * 300);
                }
                setTimeout(() => opp.speedMod = 1, 2500);
                break;

            case "spice_soften":
                // Trish: softens ground, opponent sinks, then launches
                opp.speedMod = 0.15;
                this.invul = 60;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.6, this.facing);
                    opp.vy = -16;
                    opp.speedMod = 1;
                }, 700);
                break;

            case "time_erase":
                // Diavolo: erases time — opponent takes damage with no reaction
                this.invul = 80;
                opp.invul = 0;
                opp.stunned = 0;
                opp.takeDamage(this.data.dmg * 2.0, this.facing);
                opp.stunned = 60;
                break;

            case "iron_extraction":
                // Risotto: forms blades inside opponent's blood
                opp.speedMod = 0.2;
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => opp.takeDamage(this.data.dmg * 0.6, this.facing), i * 300);
                }
                setTimeout(() => opp.speedMod = 1, 2000);
                break;

            case "aging_aura":
                // Prosciutto: rapid aging surge
                opp.speedMod = 0.15;
                opp.takeDamage(this.data.dmg * 1.0, this.facing);
                setTimeout(() => opp.speedMod = 1, 5000);
                break;

            case "reel_slam":
                // Pesci: reels opponent in, body slam
                opp.stunned = 50;
                setTimeout(() => {
                    opp.x = this.x + this.facing * 65;
                    opp.takeDamage(this.data.dmg * 1.7, this.facing);
                    opp.vy = -10;
                }, 450);
                break;

            case "mold_surge":
                // Cioccolata: mold surges from below
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        const mp = new Projectile(opp.x + (Math.random() - 0.5) * 60, GROUND_Y, 0, this.id, this.data.dmg * 0.7, "mold_spore");
                        mp.vx = 0; mp.vy = -10;
                        projectiles.push(mp);
                    }, i * 150);
                }
                opp.speedMod = 0.4;
                setTimeout(() => opp.speedMod = 1, 3000);
                break;

            // ── PART 6 ────────────────────────────────────────────
            case "string_snare":
                // Jolyne: wraps opponent in string, shatters
                opp.stunned = 100;
                opp.speedMod = 0;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.9, this.facing);
                    opp.vy = -12;
                    opp.speedMod = 1;
                }, 600);
                break;

            case "heaven_acceleration":
                // Pucci: Made in Heaven time acceleration
                this.speedMod = 3.5;
                this.invul = 120;
                opp.speedMod = 0.15;
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                        if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp))
                            opp.takeDamage(this.data.dmg * 0.5, this.facing);
                    }, i * 80);
                }
                setTimeout(() => { this.speedMod = 1; opp.speedMod = 1; }, 4000);
                break;

            case "kiss_double":
                // Ermes: sticker duplicate, double damage on next hit
                opp.takeDamage(this.data.dmg * 2.2, this.facing);
                opp.stunned = 50;
                break;

            case "heavy_weather":
                // Weather Report: rainbow snail curse
                opp.speedMod = 0.2;
                opp.stunned = 60;
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => opp.takeDamage(this.data.dmg * 0.7, this.facing), i * 400);
                }
                setTimeout(() => opp.speedMod = 1, 3000);
                break;

            case "diver_bomb":
                // Anasui: spring stored inside, violent release
                this.invul = 60;
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.2, this.facing);
                    opp.vy = -18;
                }, 400);
                break;

            case "ff_scatter":
                // F.F.: body scatters into plankton cloud
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const dir = i % 2 === 0 ? 1 : -1;
                        const p = new Projectile(this.x + this.w / 2, this.y + this.h / 2, dir, this.id, this.data.dmg * 0.5, "plankton_shot");
                        p.vy = (i - 3.5) * 2.5;
                        projectiles.push(p);
                    }, i * 50);
                }
                this.hp = Math.min(this.data.hp, this.hp + 20);
                break;

            case "zombie_summon":
                // Sports Maxx: invisible zombie horde
                opp.stunned = 80;
                opp.takeDamage(this.data.dmg * 1.4, this.facing);
                this.invul = 60;
                break;

            case "disc_extract":
                // Whitesnake: extract Stand DISC, opponent loses speed
                opp.speedMod = 0.3;
                opp.stunned = 100;
                setTimeout(() => opp.speedMod = 1, 4000);
                opp.takeDamage(this.data.dmg * 0.8, this.facing);
                break;

            // ── PART 7 ────────────────────────────────────────────
            case "tusk_act4":
                // Johnny: infinite rotation nail drills through
                {
                    const nail = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 2.5, "spinning_nail");
                    nail.w = 40; nail.h = 16; nail.vx = this.facing * 18;
                    projectiles.push(nail);
                }
                break;

            case "golden_spin":
                // Gyro: Ball Breaker golden explosion
                {
                    const gb2 = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 2.0, "steelball");
                    gb2.isExplosive = true;
                    gb2.w = 30; gb2.h = 30;
                    gb2.vx = this.facing * 14;
                    projectiles.push(gb2);
                }
                break;

            case "d4c_shift":
                // Valentine: Love Train, redirects damage for 3s
                this.invul = 180;
                this.hp = Math.min(this.data.hp, this.hp + 20);
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                break;

            case "dino_rush":
                // Diego: raptor charge + brief timestop
                this.speedMod = 2.2;
                this.invul = 60;
                opp.takeDamage(this.data.dmg * 1.6, this.facing);
                setTimeout(() => { timeStopped = true; timeStopperId = this.id; tsOverlay.style.display = 'block'; tsOverlay.style.background = 'rgba(0,180,0,0.12)'; }, 300);
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; this.speedMod = 1; }, 1800);
                break;

            case "paralysis_field":
                // Wekapipo: left-side paralysis
                opp.speedMod = 0.1;
                opp.stunned = 120;
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                setTimeout(() => opp.speedMod = 1, 3000);
                break;

            case "sound_run":
                // Sandman: stored sound energy shockwave
                for (let dir of [1, -1]) {
                    const sw = new Projectile(this.x + this.w / 2, this.y + 50, dir, this.id, this.data.dmg * 1.4, "sand_blade");
                    sw.w = 50; sw.h = 20; sw.vx = dir * 16;
                    projectiles.push(sw);
                }
                this.speedMod = 2.0;
                setTimeout(() => this.speedMod = 1, 1500);
                break;

            case "hey_ya_luck":
                // Pocoloco: Hey Ya critical hit (70% chance of 2.5x)
                if (Math.random() > 0.3) {
                    opp.takeDamage(this.data.dmg * 2.5, this.facing);
                } else {
                    opp.takeDamage(this.data.dmg * 1.0, this.facing);
                }
                this.hp = Math.min(this.data.hp, this.hp + 15);
                break;

            // ── PART 8 ────────────────────────────────────────────
            case "plunder_bubble":
                // Josuke 8: large bubble plunders opponent's speed
                {
                    const pb = new Projectile(this.x + this.w / 2, this.y + 50, this.facing, this.id, this.data.dmg * 1.2, "bubble");
                    pb.w = 45; pb.h = 45; pb.vx = this.facing * 8;
                    pb.onHit = () => { opp.speedMod = 0.25; setTimeout(() => opp.speedMod = 1, 5000); };
                    projectiles.push(pb);
                }
                break;

            case "scent_fragment":
                // Norisuke: rips fragment and home-strikes
                opp.stunned = 70;
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x - this.facing * 70));
                break;

            case "reroute":
                // Yasuho: reroutes damage back at attacker
                this.invul = 130;
                this.hp = Math.min(this.data.hp, this.hp + 25);
                opp.stunned = 80;
                opp.takeDamage(this.data.dmg * 1.0, this.facing);
                break;

            case "body_hijack":
                // Dolomite: hijacks opponent's body, forces wall slam
                opp.stunned = 60;
                opp.vx = this.facing * 18;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.4, this.facing);
                    opp.stunned = 40;
                }, 500);
                break;

            case "fever_burst":
                // Jobin: releases all stored heat at once
                opp.takeDamage(this.data.dmg * 2.0, this.facing);
                opp.stunned = 80;
                opp.speedMod = 0.3;
                setTimeout(() => opp.speedMod = 1, 3000);
                break;

            case "surface_flatten":
                // Rai: slides under opponent, pops up for launch
                this.invul = 60;
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x - this.w / 2));
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.6, this.facing);
                    opp.vy = -17;
                }, 300);
                break;

            case "pursuit_calamity":
                // Wonder of U: calamity curse — anyone attacking takes damage
                this.invul = 150;
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                opp.stunned = 60;
                for (let i = 0; i < 4; i++) {
                    const cp = new Projectile(opp.x + (Math.random() - 0.5) * 200, 0, 0, this.id, this.data.dmg * 0.6, "calamity_bolt");
                    cp.vx = 0; cp.vy = 16;
                    projectiles.push(cp);
                }
                break;

            case "limb_extend":
                // Ojiro: extends all limbs, surrounds and squeezes
                for (let dir of [1, -1]) {
                    const lp = new Projectile(this.x + this.w / 2, this.y + 40, dir, this.id, this.data.dmg * 0.9, "shard");
                    lp.w = 60; lp.h = 14; lp.vx = dir * 10;
                    projectiles.push(lp);
                }
                opp.stunned = 70;
                break;

            // ── PART 9 ────────────────────────────────────────────
            case "november_downpour":
                // Jodio: concentrated downpour of high-pressure drops
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const rx = opp.x + (Math.random() - 0.5) * 100;
                        const rp = new Projectile(rx, 0, 0, this.id, this.data.dmg * 0.7, "raindrop");
                        rp.vx = 0; rp.vy = 20;
                        projectiles.push(rp);
                    }, i * 90);
                }
                break;

            case "skin_slip":
                // Dragona: phases through hit, counterstrikes from behind
                this.invul = 90;
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x + this.facing * 70));
                this.facing = -this.facing;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.8, this.facing);
                }, 250);
                break;

            case "hustle_transfer":
                // Paco: transfers all his damage back to opponent
                {
                    const transferred = (this.data.hp - this.hp) * 0.6;
                    opp.takeDamage(Math.max(transferred, this.data.dmg), this.facing);
                    this.hp = Math.min(this.data.hp, this.hp + transferred * 0.3);
                }
                break;

            case "sonic_boom":
                // HOWLER: full boom in both directions
                for (let dir of [1, -1]) {
                    const boom = new Projectile(this.x + this.w / 2, this.y + 50, dir, this.id, this.data.dmg * 1.3, "sound_wave");
                    boom.w = 50; boom.h = 25; boom.vx = dir * 14;
                    projectiles.push(boom);
                }
                opp.stunned = 60;
                break;

            case "do_re_mi_trap":
                // Meryl: scale mines across the ground
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const mx = this.x + this.facing * (60 + i * 90);
                        const mine = new Projectile(mx, GROUND_Y - 10, 0, this.id, this.data.dmg * 1.1, "music_note");
                        mine.vx = 0; mine.vy = 0;
                        mine.isMine = true;
                        projectiles.push(mine);
                    }, i * 100);
                }
                break;

            case "glitch_nuke":
                // ??? : everything at once — timestop, nuke damage, screen flash, projectile storm
                timeStopped = true; timeStopperId = this.id;
                tsOverlay.style.display = 'block';
                tsOverlay.style.background = 'rgba(255,0,0,0.25)';
                // Instant massive damage
                opp.takeDamage(this.data.dmg * 3, this.facing);
                opp.stunned = 180;
                opp.vy = -20;
                // Storm of projectiles from all directions
                for (let i = 0; i < 20; i++) {
                    setTimeout(() => {
                        for (let dir of [1, -1]) {
                            const p = new Projectile(this.x + this.w/2, this.y + this.h/2, dir, this.id, this.data.dmg * 0.8, "shard");
                            p.vy = (Math.random() - 0.5) * 20;
                            p.vx = dir * (10 + Math.random() * 12);
                            projectiles.push(p);
                        }
                    }, i * 60);
                }
                // Heal self during the chaos
                this.hp = Math.min(this.data.hp, this.hp + 200);
                this.invul = 200;
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; }, 3000);
                break;
        }
        updateBars();
    }

    takeDamage(dmg, dir) {
        if (this.invul > 0) return;
        this.hp -= dmg;
        this.hitFlash = 6;
        this.x += dir * 25;
        if (this.hp <= 0) { this.hp = 0; endGame(this.id === 1 ? 2 : 1); }
        updateBars();
    }

    gainSP(a) { this.sp = Math.min(100, this.sp + a); updateBars(); }
    checkCollision(x, y, w, h, t) { return x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y; }

    draw() {
        ctx.save();
        ctx.translate(-camera.x, 0);
        if (this.hitFlash > 0) ctx.filter = "brightness(3)";
        ctx.fillStyle = this.data.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.strokeStyle = "white";
        ctx.lineWidth = 3;
        ctx.strokeRect(this.x, this.y, this.w, this.h);
        // Eyes
        ctx.fillStyle = "black";
        ctx.fillRect(this.x + (this.facing === 1 ? 35 : 5), this.y + 15, 15, 10);
        // Melee hitbox
        if (this.isAttacking && this.data.type === "melee") {
            ctx.fillStyle = "rgba(255,255,255,0.4)";
            const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
            ctx.fillRect(hx, this.y + 30, this.meleeBox.w, this.meleeBox.h);
        }
        if (this.stunned > 0) {
            ctx.fillStyle = "yellow";
            ctx.font = "20px Bangers";
            ctx.fillText("STUNNED!", this.x - 10, this.y - 15);
        }
        if (this.invul > 0 && this.invul % 4 < 2) {
            ctx.strokeStyle = "cyan";
            ctx.lineWidth = 4;
            ctx.strokeRect(this.x - 4, this.y - 4, this.w + 8, this.h + 8);
        }
        // SPECIAL READY indicator
        if (this.sp >= 100) {
            const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 150);
            ctx.globalAlpha = pulse;
            ctx.fillStyle = this.id === 1 ? '#00ffff' : '#ff4444';
            ctx.font = "bold 16px Bangers";
            ctx.textAlign = "center";
            ctx.fillText("★ SPECIAL READY ★", this.x + this.w / 2, this.y - 30);
            ctx.globalAlpha = 1;
        }
        // Glitch effect for secret character
        if (this.data.secret) {
            const glitch = Math.sin(Date.now() / 60) > 0.5;
            ctx.strokeStyle = glitch ? '#ff0000' : '#ff00ff';
            ctx.lineWidth = 3 + Math.random() * 4;
            ctx.strokeRect(this.x - 4, this.y - 4, this.w + 8, this.h + 8);
            // Glitchy offset copy
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = glitch ? '#ff0000' : '#00ffff';
            ctx.fillRect(this.x + (Math.random() - 0.5) * 10, this.y + (Math.random() - 0.5) * 10, this.w, this.h);
            ctx.globalAlpha = 1;
        }
        // Name tag
        ctx.fillStyle = this.id === 1 ? 'var(--jojo-blue, #3498db)' : '#e74c3c';
        ctx.font = "bold 13px Bangers";
        ctx.textAlign = "center";
        ctx.fillText(this.data.name, this.x + this.w / 2, this.y - 5);
        ctx.textAlign = "left";
        ctx.restore();
    }
}

// ============================================================
// PROJECTILE CLASS
// ============================================================
class Projectile {
    constructor(x, y, dir, ownerId, dmg, type) {
        this.x = x; this.y = y;
        this.vx = dir * 15;
        this.vy = 0;
        this.ownerId = ownerId;
        this.dmg = dmg;
        this.type = type;
        this.active = true;
        this.w = 20; this.h = 10;
        this.isExplosive = false;
        this.isHoming = false;
        this.guided = false;
        this.isMine = false;
        this.homingTarget = null;
        this.guidedTarget = null;
        this.onHit = null;
        // Size/speed tweaks per type
        const cfg = {
            bubble:         { w:25,  h:25,  sp:0.7 },
            string:         { w:40,  h:4,   sp:1.2 },
            steelball:      { w:20,  h:20,  sp:1.0 },
            hair:           { w:35,  h:6,   sp:1.0 },
            lightning:      { w:10,  h:30,  sp:1.0 },
            lightning_bolt: { w:12,  h:35,  sp:1.0 },
            rain:           { w:4,   h:14,  sp:1.0 },
            raindrop:       { w:5,   h:16,  sp:1.0 },
            sound_wave:     { w:30,  h:12,  sp:1.0 },
            calamity:       { w:25,  h:25,  sp:0.8 },
            calamity_bolt:  { w:14,  h:28,  sp:1.0 },
            aerosmith:      { w:22,  h:12,  sp:1.0 },
            aerosmith_bullet:{ w:16, h:8,   sp:1.1 },
            disc:           { w:22,  h:8,   sp:1.0 },
            iron:           { w:8,   h:8,   sp:1.3 },
            iron_shard:     { w:10,  h:6,   sp:1.3 },
            mold:           { w:18,  h:18,  sp:0.6 },
            mold_spore:     { w:16,  h:16,  sp:0.7 },
            sand:           { w:14,  h:10,  sp:1.1 },
            sand_blade:     { w:18,  h:10,  sp:1.1 },
            capsule:        { w:16,  h:16,  sp:0.9 },
            fishhook:       { w:12,  h:12,  sp:1.0 },
            knife:          { w:18,  h:6,   sp:1.4 },
            shard:          { w:14,  h:8,   sp:1.2 },
            bomb_tank:      { w:24,  h:20,  sp:0.4 },
            spinning_nail:  { w:22,  h:10,  sp:1.3 },
            wrecking_ball:  { w:20,  h:20,  sp:1.0 },
            plankton_shot:  { w:12,  h:12,  sp:1.1 },
            harvest_swarm:  { w:18,  h:10,  sp:0.9 },
            paisley_vine:   { w:30,  h:6,   sp:0.8 },
            music_note:     { w:14,  h:14,  sp:0.0 }, // mine, stays still
        };
        const c = cfg[type];
        if (c) { this.w = c.w; this.h = c.h; this.vx *= c.sp; }
    }

    update(opp) {
        if (timeStopped && timeStopperId !== this.ownerId) return;

        // Guided bullet (Hol Horse) — gradually steers toward target
        if (this.guided && this.guidedTarget) {
            const tx = this.guidedTarget.x + this.guidedTarget.w / 2;
            const ty = this.guidedTarget.y + this.guidedTarget.h / 2;
            const dx = tx - (this.x + this.w / 2);
            const dy = ty - (this.y + this.h / 2);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            this.vx += (dx / dist) * 1.2;
            this.vy += (dy / dist) * 1.2;
            const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            if (spd > 16) { this.vx = (this.vx / spd) * 16; this.vy = (this.vy / spd) * 16; }
        }

        // Homing bomb (Sheer Heart Attack) — slow ground roll toward target
        if (this.isHoming && this.homingTarget) {
            const tx = this.homingTarget.x + this.homingTarget.w / 2;
            this.vx += (tx > this.x ? 1 : -1) * 0.5;
            this.vx = Math.max(-9, Math.min(9, this.vx));
            // Stay on ground
            if (this.y < GROUND_Y - this.h) this.vy += GRAVITY;
            else { this.y = GROUND_Y - this.h; this.vy = 0; }
        }

        // Mines stay still
        if (this.isMine) {
            const hit = this.x < opp.x + opp.w && this.x + this.w > opp.x &&
                        this.y < opp.y + opp.h && this.y + this.h > opp.y;
            if (hit) {
                opp.takeDamage(this.dmg, this.vx >= 0 ? 1 : -1);
                opp.vy = -12;
                this.active = false;
            }
            return;
        }

        this.x += this.vx;
        this.y += this.vy;
        if (this.x < -100 || this.x > WORLD_WIDTH + 100 || this.y > GROUND_Y + 80 || this.y < -100) this.active = false;

        const hit = this.x < opp.x + opp.w && this.x + this.w > opp.x &&
                    this.y < opp.y + opp.h && this.y + this.h > opp.y;
        if (hit) {
            opp.takeDamage(this.dmg, this.vx >= 0 ? 1 : -1);
            const owner = this.ownerId === 1 ? player1 : player2;
            owner.gainSP(SP_PER_HIT * 0.8);
            if (this.isExplosive) { opp.vx = (this.vx > 0 ? 1 : -1) * 20; opp.vy = -10; }
            if (this.onHit) this.onHit();
            this.active = false;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(-camera.x, 0);
        const colors = {
            emerald: "#2ecc71",     bullet: "#f1c40f",      nail: "#3498db",
            spinning_nail: "#54a0ff", steelball: "#95a5a6", wrecking_ball: "#b2bec3",
            string: "#1abc9c",      bubble: "rgba(135,206,235,0.7)",
            flame: "#e74c3c",       clacker: "#e67e22",     hair: "#6c5ce7",
            harvest: "#fdcb6e",     harvest_swarm: "#fdcb6e",
            plankton: "#81ecec",    plankton_shot: "#81ecec",
            disc: "#dfe6e9",        iron: "#b2bec3",        iron_shard: "#b2bec3",
            mold: "#a8e063",        mold_spore: "#a8e063",
            aerosmith: "#e84393",   aerosmith_bullet: "#e84393",
            lightning: "#74b9ff",   lightning_bolt: "#74b9ff",
            rain: "#1289A7",        raindrop: "#1289A7",
            sound_wave: "#F79F1F",  calamity: "#2d3436",    calamity_bolt: "#555",
            water: "#3498db",       fishhook: "#55efc4",
            sand_blade: "#e58e26",  sand: "#c9a84c",
            capsule: "#8e44ad",     arrow: "#e17055",
            knife: "#ecf0f1",       shard: "#a29bfe",
            bomb_tank: "#e74c3c",   paisley_vine: "#eccc68",
            music_note: "#9980FA",
        };

        ctx.globalAlpha = 1;
        ctx.fillStyle = colors[this.type] || "white";

        if (this.type === "bubble" || this.type === "steelball" || this.type === "wrecking_ball" ||
            this.type === "plankton" || this.type === "plankton_shot" || this.type === "harvest" ||
            this.type === "harvest_swarm" || this.type === "mold" || this.type === "mold_spore") {
            ctx.beginPath();
            ctx.arc(this.x + this.w/2, this.y + this.h/2, this.w/2, 0, Math.PI*2);
            ctx.fill();
            if (this.type === "bubble") { ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2; ctx.stroke(); }

        } else if (this.type === "lightning" || this.type === "lightning_bolt" ||
                   this.type === "rain" || this.type === "raindrop" || this.type === "calamity_bolt") {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillRect(this.x + 2, this.y + 2, Math.max(1, this.w-4), Math.max(1, this.h-4));

        } else if (this.type === "flame") {
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w/2, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "#f39c12";
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w/3, 0, Math.PI*2); ctx.fill();

        } else if (this.type === "fishhook") {
            ctx.strokeStyle = colors["fishhook"]; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(this.x+6, this.y+6, 6, Math.PI, 0); ctx.lineTo(this.x+12, this.y+12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(this.x, this.y+6); ctx.lineTo(this.x-20, this.y+6);
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.stroke();

        } else if (this.type === "capsule") {
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w/2, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(this.x+3, this.y+8); ctx.lineTo(this.x+13, this.y+8); ctx.stroke();

        } else if (this.type === "sand" || this.type === "sand_blade" || this.type === "shard") {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y+this.h); ctx.lineTo(this.x+this.w/2, this.y); ctx.lineTo(this.x+this.w, this.y+this.h);
            ctx.closePath(); ctx.fill();

        } else if (this.type === "knife") {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(this.x, this.y, this.w * 0.6, this.h * 0.5);

        } else if (this.type === "spinning_nail") {
            ctx.save();
            ctx.translate(this.x + this.w/2, this.y + this.h/2);
            ctx.rotate(Date.now() / 80);
            ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.fillRect(-this.w/2, 0, this.w, 2);
            ctx.restore();

        } else if (this.type === "bomb_tank") {
            // Sheer Heart Attack — small tank bomb
            ctx.fillStyle = "#e74c3c";
            ctx.fillRect(this.x, this.y+5, this.w, this.h-5);
            ctx.fillStyle = "#c0392b";
            ctx.fillRect(this.x-4, this.y+8, 6, this.h-10);
            ctx.fillRect(this.x+this.w-2, this.y+8, 6, this.h-10);
            ctx.fillStyle = "#f39c12";
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+5, 6, 0, Math.PI*2); ctx.fill();

        } else if (this.type === "music_note") {
            // Mine — glowing note on the ground
            ctx.fillStyle = colors["music_note"];
            ctx.font = "18px serif";
            ctx.fillText("♩", this.x, this.y+14);
            ctx.globalAlpha = 0.4 + 0.3 * Math.sin(Date.now() / 200);
            ctx.strokeStyle = "#9980FA"; ctx.lineWidth = 8;
            ctx.beginPath(); ctx.arc(this.x+7, this.y+5, 14, 0, Math.PI*2); ctx.stroke();

        } else if (this.type === "sound_wave") {
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = colors["sound_wave"]; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w/2, 0, Math.PI*2); ctx.stroke();
            ctx.globalAlpha = 0.4;
            ctx.beginPath(); ctx.arc(this.x+this.w/2, this.y+this.h/2, this.w*0.8, 0, Math.PI*2); ctx.stroke();

        } else if (this.type === "hair" || this.type === "string" || this.type === "paisley_vine") {
            ctx.strokeStyle = colors[this.type]; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(this.x, this.y+this.h/2); ctx.lineTo(this.x+this.w, this.y+this.h/2); ctx.stroke();

        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
        }

        ctx.globalAlpha = 1;
        ctx.restore();
    }
}

// ============================================================
// AI CONTROLLER
// ============================================================
class AIController {
    constructor(aiPlayer, difficulty) {
        this.ai = aiPlayer;
        this.difficulty = difficulty;

        const cfg = {
            easy:   { reactionDelay: 40, attackRange: 170, jumpChance: 0.005, specialChance: 0.004, retreatHP: 0,    mistakeChance: 0.25, preferDist: 320 },
            medium: { reactionDelay: 18, attackRange: 190, jumpChance: 0.012, specialChance: 0.018, retreatHP: 0.25, mistakeChance: 0.10, preferDist: 280 },
            hard:   { reactionDelay: 6,  attackRange: 210, jumpChance: 0.022, specialChance: 0.040, retreatHP: 0.18, mistakeChance: 0.02, preferDist: 250 },
        };
        this.cfg = cfg[difficulty];
        this.decisionTimer = 0;
        this.jumpCooldown = 0;

        // Current decision state — held between frames so movement is smooth
        this.wantLeft   = false;
        this.wantRight  = false;
        this.wantAttack = false;
        this.wantJump   = false;
        this.wantSpecial = false;
    }

    press(ctrl)   { keys[this.ai.controls[ctrl]] = true; }
    release(ctrl) { keys[this.ai.controls[ctrl]] = false; }

    applyInputs() {
        keys[this.ai.controls.left]    = this.wantLeft;
        keys[this.ai.controls.right]   = this.wantRight;
        keys[this.ai.controls.attack]  = this.wantAttack;
        keys[this.ai.controls.up]      = this.wantJump;
        keys[this.ai.controls.special] = this.wantSpecial;
    }

    update(opponent) {
        if (!gameRunning) return;

        // Can't act while stunned or time-stopped by opponent
        if (this.ai.stunned > 0 || (timeStopped && timeStopperId !== this.ai.id)) {
            this.wantLeft = this.wantRight = this.wantAttack = this.wantJump = this.wantSpecial = false;
            this.applyInputs();
            return;
        }

        if (this.jumpCooldown > 0) this.jumpCooldown--;

        // Only re-think every N frames — but keep holding inputs from last decision
        this.decisionTimer--;
        if (this.decisionTimer <= 0) {
            this.decisionTimer = this.cfg.reactionDelay;
            this.think(opponent);
        }

        // Always apply whatever current decision is — this is the key fix
        this.applyInputs();

        // Release jump after 1 frame so it doesn't hold
        this.wantJump = false;
    }

    think(opponent) {
        // Reset
        this.wantLeft = this.wantRight = this.wantAttack = this.wantJump = this.wantSpecial = false;

        // Random mistake — AI does nothing this tick
        if (Math.random() < this.cfg.mistakeChance) return;

        const aiCX   = this.ai.x + this.ai.w / 2;
        const oppCX  = opponent.x + opponent.w / 2;
        const dist   = Math.abs(aiCX - oppCX);
        const isLeft = aiCX > oppCX;   // true = AI is to the right of opponent
        const hpRatio = this.ai.hp / this.ai.data.hp;
        const isRanged = this.ai.data.type === 'ranged';

        // ── USE SPECIAL when SP full ──────────────────────────────
        if (this.ai.sp >= 100 && Math.random() < this.cfg.specialChance) {
            this.wantSpecial = true;
            return;
        }

        // ── LOW HP RETREAT (medium/hard) ──────────────────────────
        if (this.cfg.retreatHP > 0 && hpRatio < this.cfg.retreatHP && dist < 250) {
            // Run away and jump
            this.wantLeft  = !isLeft;
            this.wantRight = isLeft;
            if (!this.ai.isJumping && this.jumpCooldown <= 0 && Math.random() < 0.4) {
                this.wantJump = true;
                this.jumpCooldown = 55;
            }
            return;
        }

        // ── RANGED CHARACTER BEHAVIOUR ────────────────────────────
        if (isRanged) {
            const pref = this.cfg.preferDist;
            if (dist > pref + 50) {
                // Too far — move closer
                this.wantLeft  = isLeft;
                this.wantRight = !isLeft;
            } else if (dist < pref - 60) {
                // Too close — back up
                this.wantLeft  = !isLeft;
                this.wantRight = isLeft;
            }
            // Always try to fire if attack CD is ready and within range
            if (dist < pref + 120 && this.ai.attackCD <= 0) {
                this.wantAttack = true;
            }
        }

        // ── MELEE CHARACTER BEHAVIOUR ─────────────────────────────
        else {
            if (dist > this.cfg.attackRange) {
                // Close the gap aggressively
                this.wantLeft  = isLeft;
                this.wantRight = !isLeft;
                // Jump to close distance faster on hard
                if (!this.ai.isJumping && this.jumpCooldown <= 0 && dist > 350 && Math.random() < this.cfg.jumpChance * 4) {
                    this.wantJump = true;
                    this.jumpCooldown = 45;
                }
            } else {
                // In range — attack
                if (this.ai.attackCD <= 0) this.wantAttack = true;
                // Occasionally dodge sideways after attacking
                if (Math.random() < 0.15) {
                    this.wantLeft  = !isLeft;
                    this.wantRight = isLeft;
                }
            }
        }

        // ── RANDOM JUMP to dodge/reposition ──────────────────────
        if (!this.ai.isJumping && this.jumpCooldown <= 0 && Math.random() < this.cfg.jumpChance) {
            this.wantJump = true;
            this.jumpCooldown = 50;
        }
    }
}


function updateBars() {
    if (!player1 || !player2) return;
    document.getElementById('p1-hp').style.width = (player1.hp / player1.data.hp) * 100 + "%";
    document.getElementById('p2-hp').style.width = (player2.hp / player2.data.hp) * 100 + "%";
    const p1sp = player1.sp, p2sp = player2.sp;
    const p1spEl = document.getElementById('p1-sp'), p2spEl = document.getElementById('p2-sp');
    p1spEl.style.width = p1sp + "%";
    p2spEl.style.width = p2sp + "%";
    p1sp >= 100 ? p1spEl.classList.add('sp-ready') : p1spEl.classList.remove('sp-ready');
    p2sp >= 100 ? p2spEl.classList.add('sp-ready') : p2spEl.classList.remove('sp-ready');
}

// ============================================================
// GAME INIT / END
// ============================================================
function initGame() {
    selectingPlayer = 1;
    projectiles = [];
    document.getElementById('char-select').style.display = 'none';
    document.getElementById('stage-select').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';

    player1 = new Player(1, WORLD_WIDTH * 0.3, p1Data, { up: 'KeyW', left: 'KeyA', right: 'KeyD', attack: 'KeyF', special: 'KeyG' });
    player2 = new Player(2, WORLD_WIDTH * 0.7, p2Data, { up: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', attack: 'KeyL', special: 'KeyK' });

    document.getElementById('p1-label').innerText = p1Data.name;

    if (gameMode === 'cpu') {
        // Show AI character name + difficulty badge
        document.getElementById('p2-label').innerText = p2Data.name;
        // Add AI badge to p2 stats
        const p2stats = document.querySelector('.player-stats:last-child');
        let badge = document.getElementById('ai-label');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'ai-label';
            badge.innerText = 'CPU · ' + aiDifficulty.toUpperCase();
            p2stats.appendChild(badge);
        } else {
            badge.innerText = 'CPU · ' + aiDifficulty.toUpperCase();
            badge.style.display = '';
        }
        aiController = new AIController(player2, aiDifficulty);
    } else {
        document.getElementById('p2-label').innerText = p2Data.name;
        aiController = null;
        const badge = document.getElementById('ai-label');
        if (badge) badge.style.display = 'none';
    }

    gameRunning = true;
    updateBars();
    gameLoop();
}

function endGame(winner) {
    gameRunning = false;
    if (aiController) aiController.releaseAll();
    document.getElementById('win-screen').style.display = 'flex';
    const winnerData = winner === 1 ? p1Data : p2Data;
    const isCPUWin = gameMode === 'cpu' && winner === 2;
    document.getElementById('win-text').innerText = winnerData.name + (isCPUWin ? ' (CPU) WINS!' : ' WINS!');
    document.getElementById('win-text').style.color = winner === 1 ? 'var(--jojo-blue)' : 'var(--jojo-red)';
}

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// ============================================================
// GAME LOOP
// ============================================================
function gameLoop() {
    if (!gameRunning) return;

    // Tick AI before player updates so inputs are set
    if (aiController) aiController.update(player1);

    player1.update(player2);
    player2.update(player1);
    projectiles = projectiles.filter(p => p.active);
    projectiles.forEach(p => p.update(p.ownerId === 1 ? player2 : player1));
    camera.follow(player1, player2);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, 0);

    // Stage background
    if (selectedStage) {
        selectedStage.draw(ctx, WORLD_WIDTH, WORLD_HEIGHT, GROUND_Y);
    } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }

    // Ground overlay grid lines
    ctx.strokeStyle = "rgba(255,215,0,0.10)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= WORLD_WIDTH; i += 150) {
        ctx.beginPath(); ctx.moveTo(i, GROUND_Y); ctx.lineTo(i, WORLD_HEIGHT); ctx.stroke();
    }

    ctx.restore();

    projectiles.forEach(p => p.draw());
    player1.draw();
    player2.draw();
    requestAnimationFrame(gameLoop);
}
