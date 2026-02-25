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
        name: "Jotaro",
        part: 3,
        color: "#2c3e50",
        hp: 220,
        speed: 6.2,
        dmg: 16,
        type: "melee",
        specialType: "timestop",
        duration: 1800,
        sound: "timestop",
        desc: "Star Platinum: ORA Barrage + Brief Time Stop"
    },
    {
        name: "Dio",
        part: 3,
        color: "#f1c40f",
        hp: 180,
        speed: 7,
        dmg: 14,
        type: "melee",
        specialType: "timestop",
        duration: 4000,
        sound: "diotimestop",
        desc: "The World: MUDA Barrage + Massive Time Stop"
    },
    {
        name: "Kakyoin",
        part: 3,
        color: "#27ae60",
        hp: 160,
        speed: 6.5,
        dmg: 10,
        type: "ranged",
        projectile: "emerald",
        specialType: "barrier",
        desc: "Hierophant Green: Emerald Splash Barrage"
    },
    {
        name: "Polnareff",
        part: 3,
        color: "#c0c0c0",
        hp: 185,
        speed: 6.8,
        dmg: 15,
        type: "melee",
        specialType: "triple_slash",
        desc: "Silver Chariot: Rapid Triple Thrust Combo"
    },
    {
        name: "Avdol",
        part: 3,
        color: "#e74c3c",
        hp: 175,
        speed: 5.8,
        dmg: 13,
        type: "ranged",
        projectile: "flame",
        specialType: "crossfire",
        desc: "Magician's Red: Crossfire Hurricane Barrage"
    },
    {
        name: "Iggy",
        part: 3,
        color: "#7f8c8d",
        hp: 130,
        speed: 8.5,
        dmg: 9,
        type: "ranged",
        projectile: "sand",
        specialType: "sand_decoy",
        desc: "The Fool: Sand Razor Shards & Clone Decoy"
    },
    {
        name: "Joseph",
        part: 3,
        color: "#e67e22",
        hp: 190,
        speed: 6.5,
        dmg: 12,
        type: "ranged",
        projectile: "clacker",
        specialType: "hermit_trap",
        desc: "Hermit Purple: Vine Trap & Clackers Volley"
    },
    {
        name: "Rubber Soul",
        part: 3,
        color: "#2ecc71",
        hp: 155,
        speed: 7.2,
        dmg: 11,
        type: "melee",
        specialType: "mimic",
        desc: "Yellow Temperance: Mimic & Absorb Damage"
    },
    {
        name: "Hol Horse",
        part: 3,
        color: "#d4a017",
        hp: 150,
        speed: 7.0,
        dmg: 9,
        type: "ranged",
        projectile: "bullet",
        specialType: "multi",
        desc: "Emperor: Guided Bullet Burst Fire"
    },
    {
        name: "N'Doul",
        part: 3,
        color: "#1a6bb5",
        hp: 160,
        speed: 6.0,
        dmg: 14,
        type: "ranged",
        projectile: "water",
        specialType: "blind_strike",
        desc: "Geb: Invisible Water Slash Attack"
    },
    {
        name: "Mariah",
        part: 3,
        color: "#ff6b9d",
        hp: 145,
        speed: 7.5,
        dmg: 8,
        type: "melee",
        specialType: "magnetize",
        desc: "Bastet: Touch Magnetize & Metal Object Crush"
    },
    {
        name: "Vanilla Ice",
        part: 3,
        color: "#8e44ad",
        hp: 200,
        speed: 6.5,
        dmg: 19,
        type: "melee",
        specialType: "void",
        desc: "Cream: Void Annihilation Charge"
    },

    // ─── PART 4: Diamond is Unbreakable ──────────────────────
    {
        name: "Josuke",
        part: 4,
        color: "#8e44ad",
        hp: 200,
        speed: 6,
        dmg: 15,
        type: "melee",
        specialType: "heal",
        sound: "crazydiamond",
        desc: "Crazy Diamond: Shattering Fists + Restoration"
    },
    {
        name: "Kira",
        part: 4,
        color: "#d2dae2",
        hp: 160,
        speed: 6,
        dmg: 22,
        type: "melee",
        specialType: "bomb",
        sound: "killerqueen",
        desc: "Killer Queen: Sheer Heart Attack Explosion"
    },
    {
        name: "Okuyasu",
        part: 4,
        color: "#3498db",
        hp: 210,
        speed: 5.8,
        dmg: 17,
        type: "melee",
        specialType: "erase",
        desc: "The Hand: Dimensional Erase & Gap Closer"
    },
    {
        name: "Rohan",
        part: 4,
        color: "#1dd1a1",
        hp: 150,
        speed: 7.5,
        dmg: 8,
        type: "melee",
        specialType: "stun",
        desc: "Heaven's Door: Script Lock Stun"
    },
    {
        name: "Koichi",
        part: 4,
        color: "#a29bfe",
        hp: 145,
        speed: 7.0,
        dmg: 10,
        type: "melee",
        specialType: "gravity",
        desc: "Echoes Act 3: S-H-O-K Stamp Gravity Crush"
    },
    {
        name: "Yukako",
        part: 4,
        color: "#6c5ce7",
        hp: 155,
        speed: 6.5,
        dmg: 11,
        type: "ranged",
        projectile: "hair",
        specialType: "trap",
        desc: "Love Deluxe: Hair Snare & Smash"
    },
    {
        name: "Shigechi",
        part: 4,
        color: "#fdcb6e",
        hp: 140,
        speed: 5.5,
        dmg: 9,
        type: "ranged",
        projectile: "harvest",
        specialType: "coin_burst",
        desc: "Harvest: Swarm Sting & Coin Collect Burst"
    },
    {
        name: "Hazamada",
        part: 4,
        color: "#74b9ff",
        hp: 140,
        speed: 6.0,
        dmg: 10,
        type: "melee",
        specialType: "mimic",
        desc: "Surface: Copy & Counter Attack"
    },
    {
        name: "Yoshihiro",
        part: 4,
        color: "#e17055",
        hp: 100,
        speed: 9.0,
        dmg: 7,
        type: "ranged",
        projectile: "arrow",
        specialType: "pierce",
        desc: "Ghost: Stand Arrow Puncture Shot"
    },
    {
        name: "Mikitaka",
        part: 4,
        color: "#00cec9",
        hp: 150,
        speed: 8.0,
        dmg: 10,
        type: "melee",
        specialType: "transform",
        desc: "Earth Wind & Fire: Shape-Shift Ambush"
    },

    // ─── PART 5: Golden Wind ──────────────────────────────────
    {
        name: "Giorno",
        part: 5,
        color: "#ff9ff3",
        hp: 190,
        speed: 6.5,
        dmg: 12,
        type: "melee",
        specialType: "life",
        desc: "Gold Experience: Life Counter-Strike & Heal"
    },
    {
        name: "Bruno",
        part: 5,
        color: "#f5f6fa",
        hp: 170,
        speed: 7,
        dmg: 13,
        type: "melee",
        specialType: "zipper",
        desc: "Sticky Fingers: Zipper Port & Corkscrew Punch"
    },
    {
        name: "Mista",
        part: 5,
        color: "#2e86de",
        hp: 170,
        speed: 6.8,
        dmg: 11,
        type: "ranged",
        projectile: "bullet",
        specialType: "multi",
        desc: "Sex Pistols: Target-Seeking 6-Shot Burst"
    },
    {
        name: "Abbacchio",
        part: 5,
        color: "#6c5ce7",
        hp: 175,
        speed: 6.0,
        dmg: 14,
        type: "melee",
        specialType: "replay",
        desc: "Moody Blues: Record & Replay Counter"
    },
    {
        name: "Narancia",
        part: 5,
        color: "#e84393",
        hp: 155,
        speed: 7.2,
        dmg: 10,
        type: "ranged",
        projectile: "aerosmith",
        specialType: "multi",
        desc: "Aerosmith: Strafing Machine Gun Burst"
    },
    {
        name: "Fugo",
        part: 5,
        color: "#a8e063",
        hp: 160,
        speed: 6.5,
        dmg: 16,
        type: "ranged",
        projectile: "capsule",
        specialType: "virus",
        desc: "Purple Haze: Virus Capsule Shatter & Infection Cloud"
    },
    {
        name: "Trish",
        part: 5,
        color: "#fd79a8",
        hp: 150,
        speed: 7.5,
        dmg: 9,
        type: "melee",
        specialType: "soften",
        desc: "Spice Girl: Soften Objects & Elastic Phase-Punch"
    },
    {
        name: "Diavolo",
        part: 5,
        color: "#eb4d4b",
        hp: 180,
        speed: 7.2,
        dmg: 18,
        type: "melee",
        specialType: "skip",
        sound: "kingcrimson",
        desc: "King Crimson: Epitaph Prediction + Time Erase"
    },
    {
        name: "Risotto",
        part: 5,
        color: "#636e72",
        hp: 185,
        speed: 6.5,
        dmg: 15,
        type: "ranged",
        projectile: "iron",
        specialType: "iron_burst",
        desc: "Metallica: Iron Pull from Blood + Razor Swarm"
    },
    {
        name: "Prosciutto",
        part: 5,
        color: "#b2bec3",
        hp: 165,
        speed: 6.5,
        dmg: 12,
        type: "melee",
        specialType: "age",
        desc: "The Grateful Dead: Rapid Aging Aura Slow"
    },
    {
        name: "Pesci",
        part: 5,
        color: "#55efc4",
        hp: 160,
        speed: 6.0,
        dmg: 13,
        type: "ranged",
        projectile: "fishhook",
        specialType: "reel_in",
        desc: "Beach Boy: Fishing Line Hook Cast & Reel-In Slam"
    },
    {
        name: "Cioccolata",
        part: 5,
        color: "#2d3436",
        hp: 170,
        speed: 6.0,
        dmg: 14,
        type: "ranged",
        projectile: "mold",
        specialType: "virus",
        desc: "Green Day: Climbing Mold Infection Spread"
    },

    // ─── PART 6: Stone Ocean ─────────────────────────────────
    {
        name: "Jolyne",
        part: 6,
        color: "#10ac84",
        hp: 180,
        speed: 7,
        dmg: 12,
        type: "ranged",
        projectile: "string",
        specialType: "trap",
        desc: "Stone Free: String Snare & Unravel Fist"
    },
    {
        name: "Pucci",
        part: 6,
        color: "#5f27cd",
        hp: 160,
        speed: 9.5,
        dmg: 11,
        type: "melee",
        specialType: "speed",
        desc: "Made in Heaven: Universal Time Acceleration"
    },
    {
        name: "Ermes",
        part: 6,
        color: "#e55039",
        hp: 175,
        speed: 6.8,
        dmg: 13,
        type: "melee",
        specialType: "sticker",
        desc: "Kiss: Duplicate Sticker & Double Damage Hit"
    },
    {
        name: "Weather Report",
        part: 6,
        color: "#0984e3",
        hp: 180,
        speed: 6.5,
        dmg: 11,
        type: "ranged",
        projectile: "lightning",
        specialType: "storm",
        desc: "Weather Report: Lightning Strike Storm"
    },
    {
        name: "Anasui",
        part: 6,
        color: "#fd79a8",
        hp: 165,
        speed: 6.5,
        dmg: 15,
        type: "melee",
        specialType: "dive",
        desc: "Diver Down: Phase & Internal Detonation"
    },
    {
        name: "F.F.",
        part: 6,
        color: "#81ecec",
        hp: 155,
        speed: 7.2,
        dmg: 9,
        type: "ranged",
        projectile: "plankton",
        specialType: "regen",
        desc: "Foo Fighters: Plankton Shot + Self-Regen"
    },
    {
        name: "Sports Maxx",
        part: 6,
        color: "#636e72",
        hp: 155,
        speed: 6.5,
        dmg: 11,
        type: "melee",
        specialType: "undead",
        desc: "Limp Bizkit: Invisible Undead Summon"
    },
    {
        name: "C-Moon Pucci",
        part: 6,
        color: "#dfe6e9",
        hp: 170,
        speed: 6.8,
        dmg: 13,
        type: "ranged",
        projectile: "disc",
        specialType: "disc_steal",
        desc: "Whitesnake/C-Moon: DISC Extract Throw & Gravity Invert"
    },

    // ─── PART 7: Steel Ball Run ───────────────────────────────
    {
        name: "Johnny",
        part: 7,
        color: "#54a0ff",
        hp: 150,
        speed: 5.5,
        dmg: 24,
        type: "ranged",
        projectile: "nail",
        specialType: "pierce",
        desc: "Tusk Act 4: Infinite Rotation Nail Shot"
    },
    {
        name: "Gyro",
        part: 7,
        color: "#ee5253",
        hp: 180,
        speed: 6,
        dmg: 16,
        type: "ranged",
        projectile: "steelball",
        specialType: "spinning_bomb",
        desc: "Ball Breaker: Golden Spin Explosion Throw"
    },
    {
        name: "Valentine",
        part: 7,
        color: "#0652DD",
        hp: 200,
        speed: 6.5,
        dmg: 15,
        type: "melee",
        specialType: "dimension_shift",
        desc: "Dirty Deeds D Done Dirt Cheap: Dimension Hop"
    },
    {
        name: "Diego",
        part: 7,
        color: "#009432",
        hp: 175,
        speed: 7.8,
        dmg: 14,
        type: "melee",
        specialType: "dino",
        desc: "The World (Alternate): Raptor Rush + Time Stop"
    },
    {
        name: "Wekapipo",
        part: 7,
        color: "#dff9fb",
        hp: 160,
        speed: 6.5,
        dmg: 12,
        type: "ranged",
        projectile: "steelball",
        specialType: "wrecking",
        desc: "Wrecking Ball: Paralytic Steel Ball Ricochet"
    },
    {
        name: "Sandman",
        part: 7,
        color: "#e58e26",
        hp: 165,
        speed: 8.5,
        dmg: 11,
        type: "ranged",
        projectile: "sand_blade",
        specialType: "speed",
        desc: "In a Silent Way: Sand-Blade Sprint & Slice"
    },
    {
        name: "Pocoloco",
        part: 7,
        color: "#f9ca24",
        hp: 155,
        speed: 7.5,
        dmg: 10,
        type: "melee",
        specialType: "luck",
        desc: "Hey Ya!: Fortune-Boosted Lucky Strike"
    },

    // ─── PART 8: JoJolion ────────────────────────────────────
    {
        name: "Josuke 8",
        part: 8,
        color: "#48dbfb",
        hp: 170,
        speed: 6.5,
        dmg: 12,
        type: "ranged",
        projectile: "bubble",
        specialType: "bubble_field",
        desc: "Soft & Wet: Plunder Bubble Attribute Field"
    },
    {
        name: "Norisuke IV",
        part: 8,
        color: "#ffa502",
        hp: 165,
        speed: 6.0,
        dmg: 11,
        type: "melee",
        specialType: "mark",
        desc: "King Nothing: Scent-Track & Fragment Rip"
    },
    {
        name: "Yasuho",
        part: 8,
        color: "#eccc68",
        hp: 140,
        speed: 7.5,
        dmg: 8,
        type: "melee",
        specialType: "guidance",
        desc: "Paisley Park: Path Guidance & Wound Redirect"
    },
    {
        name: "Dolomite",
        part: 8,
        color: "#b2bec3",
        hp: 160,
        speed: 6.5,
        dmg: 12,
        type: "melee",
        specialType: "teeth",
        desc: "Blue Hawaii: Remote Body-Jack Bite"
    },
    {
        name: "Jobin",
        part: 8,
        color: "#fd9644",
        hp: 175,
        speed: 6.8,
        dmg: 14,
        type: "melee",
        specialType: "speed",
        desc: "Speed King: Fever Heat Stored & Released"
    },
    {
        name: "Rai",
        part: 8,
        color: "#a29bfe",
        hp: 155,
        speed: 7.5,
        dmg: 11,
        type: "melee",
        specialType: "lucky_land",
        desc: "Doggy Style: Surface Flatten & Lucky Attack"
    },
    {
        name: "Wonder of U",
        part: 8,
        color: "#2d3436",
        hp: 190,
        speed: 5.0,
        dmg: 18,
        type: "ranged",
        projectile: "calamity",
        specialType: "calamity_field",
        desc: "Wonder of U: Calamity Aura Pursuit Damage"
    },
    {
        name: "Ojiro",
        part: 8,
        color: "#ff6b81",
        hp: 145,
        speed: 8.0,
        dmg: 13,
        type: "melee",
        specialType: "arm_extend",
        desc: "Awaking III Leaves: Extend Limbs & Strike"
    },

    // ─── PART 9: The JOJOLands ────────────────────────────────
    {
        name: "Jodio",
        part: 9,
        color: "#1289A7",
        hp: 165,
        speed: 7.0,
        dmg: 12,
        type: "ranged",
        projectile: "rain",
        specialType: "downpour",
        desc: "November Rain: Pressurized Raindrop Burst"
    },
    {
        name: "Dragona",
        part: 9,
        color: "#C4E538",
        hp: 155,
        speed: 7.8,
        dmg: 11,
        type: "melee",
        specialType: "skin",
        desc: "Smooth Operators: Skin Slip & Repositioning"
    },
    {
        name: "Paco",
        part: 9,
        color: "#ED4C67",
        hp: 200,
        speed: 5.8,
        dmg: 16,
        type: "melee",
        specialType: "heal",
        desc: "The Hustle: Injury Transference & Recovery"
    },
    {
        name: "HOWLER",
        part: 9,
        color: "#F79F1F",
        hp: 170,
        speed: 7.0,
        dmg: 13,
        type: "ranged",
        projectile: "sound_wave",
        specialType: "shockwave",
        desc: "HOWLER: Sonic Boom Concussive Wave"
    },
    {
        name: "Meryl",
        part: 9,
        color: "#9980FA",
        hp: 150,
        speed: 7.5,
        dmg: 10,
        type: "ranged",
        projectile: "spore",
        specialType: "trap",
        desc: "Doremifasolati Do: Spore Mine & Detonation"
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
CHARACTERS.forEach((char, i) => {
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
    card.onclick = () => selectChar(i, card);
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
        // Play stand sound if this character has one
        console.log('useSpecial fired for:', this.data.name, '| sound:', this.data.sound || 'none');
        if (this.data.sound) SoundManager.play(this.data.sound);
        const sType = this.data.specialType;

        switch (sType) {
            case "timestop":
                timeStopped = true;
                timeStopperId = this.id;
                tsOverlay.style.display = 'block';
                tsOverlay.style.background = `rgba(80,80,255,0.15)`;
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; }, this.data.duration);
                // Rush during timestop
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        if (this.checkCollision(
                            this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w,
                            this.y + 30, this.meleeBox.w, this.meleeBox.h, opp
                        )) {
                            opp.takeDamage(this.data.dmg * 0.4, this.facing);
                        }
                    }, i * 120);
                }
                break;
            case "heal":
                this.hp = Math.min(this.data.hp, this.hp + this.data.hp * 0.35);
                break;
            case "skip":
                this.invul = 70;
                this.x += 350 * this.facing;
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                break;
            case "multi":
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(
                            this.x + this.facing * 20,
                            this.y + 30 + (i % 3) * 15,
                            this.facing, this.id, 8, this.data.projectile || "bullet"
                        ));
                    }, i * 100);
                }
                break;
            case "pierce":
                const pierce = new Projectile(this.x, this.y + 40, this.facing, this.id, 45, "nail");
                pierce.w = 50; pierce.h = 20; pierce.vx *= 1.5;
                projectiles.push(pierce);
                break;
            case "spinning_bomb":
                const ball = new Projectile(this.x, this.y + 40, this.facing, this.id, 30, "steelball");
                ball.isExplosive = true;
                projectiles.push(ball);
                break;
            case "soften":
                // Spice Girl: soften the ground/opponent, they sink in and slow, then punch launches them
                opp.speedMod = 0.2;
                this.invul = 50;
                setTimeout(() => {
                    opp.takeDamage(this.data.dmg * 1.5, this.facing);
                    opp.vy = -14;
                    opp.speedMod = 1;
                }, 600);
                break;
            case "reel_in":
                // Beach Boy: hook hooks the opponent and drags them in for a slam
                opp.stunned = 40;
                setTimeout(() => {
                    opp.x = this.x + this.facing * 70;
                    opp.takeDamage(this.data.dmg * 1.6, this.facing);
                    opp.vy = -10;
                }, 400);
                break;
            case "guidance":
                // Paisley Park: redirect opponent's next hit back at them, brief invul + counter heal
                this.invul = 120;
                this.hp = Math.min(this.data.hp, this.hp + 20);
                opp.stunned = 60;
                break;
            case "bubble_field":
                opp.speedMod = 0.3;
                setTimeout(() => opp.speedMod = 1, 4000);
                break;
            case "stun":
                opp.stunned = 180;
                break;
            case "life":
                this.hp = Math.min(this.data.hp, this.hp + 20);
                opp.takeDamage(10, -this.facing);
                break;
            case "speed":
                this.speedMod = 2.8;
                this.invul = 100;
                setTimeout(() => this.speedMod = 1, 5000);
                break;
            case "bomb":
                if (this.checkCollision(this.x - 100, this.y - 100, 300, 300, opp))
                    opp.takeDamage(40, this.facing);
                break;
            case "erase":
                // The Hand - pull opponent towards self
                opp.x = this.x + this.facing * 80;
                opp.takeDamage(this.data.dmg, this.facing);
                break;
            case "barrier":
                this.invul = 120;
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(
                            this.x, this.y + 40, this.facing, this.id, 6, "emerald"
                        ));
                    }, i * 60);
                }
                break;
            case "triple_slash":
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        const hx = this.facing === 1 ? this.x + this.w : this.x - this.meleeBox.w;
                        if (this.checkCollision(hx, this.y + 20, this.meleeBox.w, this.meleeBox.h, opp))
                            opp.takeDamage(this.data.dmg * 0.7, this.facing);
                    }, i * 100);
                }
                break;
            case "crossfire":
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(this.x, this.y + 40 + i * 10, this.facing, this.id, 12, "flame"));
                        projectiles.push(new Projectile(this.x, this.y + 40 + i * 10, -this.facing, this.id, 12, "flame"));
                    }, i * 80);
                }
                break;
            case "sand_decoy":
                this.invul = 100;
                this.x -= this.facing * 200;
                break;
            case "hermit_trap":
                opp.stunned = 100;
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        projectiles.push(new Projectile(this.x, this.y + 40, this.facing, this.id, 8, "clacker"));
                    }, i * 80);
                }
                break;
            case "mimic":
                this.hp = Math.min(this.data.hp, this.hp + 30);
                this.invul = 80;
                break;
            case "blind_strike":
                opp.stunned = 80;
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                break;
            case "magnetize":
                opp.speedMod = 0.2;
                opp.takeDamage(this.data.dmg * 0.8, this.facing);
                setTimeout(() => opp.speedMod = 1, 3000);
                break;
            case "void":
                this.invul = 60;
                opp.takeDamage(this.data.dmg * 1.8, this.facing);
                break;
            case "gravity":
                opp.vy = 20;
                opp.stunned = 60;
                opp.takeDamage(this.data.dmg * 1.2, this.facing);
                break;
            case "coin_burst":
                for (let i = 0; i < 12; i++) {
                    setTimeout(() => {
                        const angle = (Math.random() - 0.5) * 0.8;
                        const p = new Projectile(this.x + this.w / 2, this.y + this.h / 2, this.facing, this.id, 5, "harvest");
                        p.vx = this.facing * 12 * Math.cos(angle);
                        p.vy = -8 * Math.random();
                        projectiles.push(p);
                    }, i * 50);
                }
                break;
            case "transform":
                this.invul = 90;
                this.speedMod = 1.8;
                opp.stunned = 40;
                setTimeout(() => this.speedMod = 1, 3000);
                break;
            case "replay":
                this.hp = Math.min(this.data.hp, this.hp + 25);
                opp.stunned = 60;
                break;
            case "virus":
                opp.speedMod = 0.4;
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => opp.takeDamage(8, this.facing), i * 500);
                }
                setTimeout(() => opp.speedMod = 1, 3000);
                break;
            case "surface_send":
                this.invul = 80;
                this.x += this.facing * 250;
                opp.takeDamage(this.data.dmg * 0.8, this.facing);
                break;
            case "iron_burst":
                opp.stunned = 80;
                opp.takeDamage(this.data.dmg * 1.6, this.facing);
                break;
            case "age":
                opp.speedMod = 0.25;
                setTimeout(() => opp.speedMod = 1, 5000);
                opp.takeDamage(this.data.dmg, this.facing);
                break;
            case "sticker":
                opp.takeDamage(this.data.dmg * 2, this.facing);
                break;
            case "storm":
                for (let i = 0; i < 6; i++) {
                    setTimeout(() => {
                        const lx = opp.x + (Math.random() - 0.5) * 100;
                        projectiles.push(new Projectile(lx, 0, 0, this.id, 10, "lightning"));
                        // Lightning falls down
                        const last = projectiles[projectiles.length - 1];
                        last.vy = 18; last.vx = 0;
                    }, i * 150);
                }
                break;
            case "dive":
                this.invul = 60;
                opp.takeDamage(this.data.dmg * 1.7, this.facing);
                break;
            case "regen":
                this.hp = Math.min(this.data.hp, this.hp + 35);
                break;
            case "undead":
                this.invul = 100;
                opp.stunned = 90;
                break;
            case "disc_steal":
                opp.stunned = 120;
                opp.speedMod = 0.5;
                setTimeout(() => opp.speedMod = 1, 3000);
                break;
            case "dimension_shift":
                this.invul = 90;
                this.x = Math.max(0, Math.min(WORLD_WIDTH - this.w, opp.x - this.facing * 100));
                opp.takeDamage(this.data.dmg, this.facing);
                break;
            case "dino":
                this.speedMod = 2.0;
                this.invul = 60;
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                setTimeout(() => { timeStopped = true; timeStopperId = this.id; tsOverlay.style.display = 'block'; }, 200);
                setTimeout(() => { timeStopped = false; timeStopperId = null; tsOverlay.style.display = 'none'; this.speedMod = 1; }, 1800);
                break;
            case "wrecking":
                for (let i = 0; i < 4; i++) {
                    const sb = new Projectile(this.x, this.y + 40, this.facing, this.id, 10, "steelball");
                    sb.vy = -5 + i * 3;
                    projectiles.push(sb);
                }
                break;
            case "luck":
                const bonus = Math.random();
                if (bonus > 0.3) {
                    opp.takeDamage(this.data.dmg * 2.5, this.facing);
                } else {
                    opp.takeDamage(this.data.dmg, this.facing);
                }
                this.hp = Math.min(this.data.hp, this.hp + 15);
                break;
            case "calamity_field":
                opp.takeDamage(this.data.dmg * 1.5, this.facing);
                opp.stunned = 60;
                this.invul = 80;
                break;
            case "arm_extend":
                const hx2 = this.facing === 1 ? this.x + this.w : this.x - 160;
                if (this.checkCollision(hx2, this.y + 20, 160, this.meleeBox.h, opp)) {
                    opp.takeDamage(this.data.dmg * 1.4, this.facing);
                    opp.stunned = 50;
                }
                break;
            case "downpour":
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const rx = opp.x + (Math.random() - 0.5) * 120;
                        const p2 = new Projectile(rx, 0, 0, this.id, 7, "rain");
                        p2.vy = 20; p2.vx = 0;
                        projectiles.push(p2);
                    }, i * 100);
                }
                break;
            case "skin":
                this.invul = 80;
                opp.x = opp.x + this.facing * 200;
                opp.takeDamage(this.data.dmg * 0.9, this.facing);
                break;
            case "teeth":
                opp.stunned = 90;
                opp.takeDamage(this.data.dmg * 1.1, this.facing);
                break;
            case "lucky_land":
                this.invul = 70;
                this.speedMod = 1.8;
                opp.takeDamage(this.data.dmg, this.facing);
                setTimeout(() => this.speedMod = 1, 3000);
                break;
            case "shockwave":
                for (let dir of [-1, 1]) {
                    const sw = new Projectile(this.x + this.w / 2, this.y + 50, dir, this.id, 18, "sound_wave");
                    sw.w = 35; sw.h = 15;
                    projectiles.push(sw);
                }
                break;
            case "mark":
                opp.stunned = 80;
                opp.speedMod = 0.5;
                setTimeout(() => opp.speedMod = 1, 3500);
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
        if (type === "bubble") { this.w = 25; this.h = 25; this.vx *= 0.7; }
        if (type === "string") { this.w = 40; this.h = 4; this.vx *= 1.2; }
        if (type === "steelball") { this.w = 20; this.h = 20; }
        if (type === "hair") { this.w = 35; this.h = 6; }
        if (type === "lightning") { this.w = 10; this.h = 30; }
        if (type === "rain") { this.w = 4; this.h = 14; }
        if (type === "sound_wave") { this.w = 30; this.h = 12; }
        if (type === "calamity") { this.w = 25; this.h = 25; this.vx *= 0.8; }
        if (type === "aerosmith") { this.w = 22; this.h = 12; }
        if (type === "disc") { this.w = 22; this.h = 8; }
        if (type === "iron") { this.w = 8; this.h = 8; this.vx *= 1.3; }
        if (type === "mold") { this.w = 18; this.h = 18; this.vx *= 0.6; }
        if (type === "sand") { this.w = 14; this.h = 10; this.vx *= 1.1; }
        if (type === "capsule") { this.w = 16; this.h = 16; this.vx *= 0.9; }
        if (type === "fishhook") { this.w = 12; this.h = 12; this.vx *= 1.0; }
    }

    update(opp) {
        if (timeStopped && timeStopperId !== this.ownerId) return;
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > WORLD_WIDTH || this.y > GROUND_Y + 50 || this.y < -50) this.active = false;
        const hit = this.x < opp.x + opp.w && this.x + this.w > opp.x && this.y < opp.y + opp.h && this.y + this.h > opp.y;
        if (hit) {
            opp.takeDamage(this.dmg, this.vx >= 0 ? 1 : -1);
            const owner = this.ownerId === 1 ? player1 : player2;
            owner.gainSP(SP_PER_HIT * 0.8);
            if (this.isExplosive) { opp.vx = (this.vx > 0 ? 1 : -1) * 20; opp.vy = -10; }
            this.active = false;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(-camera.x, 0);
        const colors = {
            emerald: "#2ecc71",
            bullet: "#f1c40f",
            nail: "#3498db",
            steelball: "#95a5a6",
            string: "#1abc9c",
            bubble: "rgba(135,206,235,0.7)",
            flame: "#e74c3c",
            clacker: "#e67e22",
            hair: "#6c5ce7",
            harvest: "#fdcb6e",
            plankton: "#81ecec",
            disc: "#dfe6e9",
            iron: "#b2bec3",
            mold: "#a8e063",
            aerosmith: "#e84393",
            lightning: "#74b9ff",
            rain: "#1289A7",
            sound_wave: "#F79F1F",
            calamity: "#2d3436",
            water: "#3498db",
            magnet: "#e84393",
            fishhook: "#55efc4",
            spice: "#fd79a8",
            vine: "#eccc68",
            scent: "#ffa502",
            spore: "#9980FA",
            sand_blade: "#e58e26",
            sand: "#c9a84c",
            capsule: "#8e44ad",
            sound: "#a29bfe",
            arrow: "#e17055",
        };
        ctx.fillStyle = colors[this.type] || "white";
        if (this.type === "bubble" || this.type === "steelball") {
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.5)";
            ctx.lineWidth = 2;
            ctx.stroke();
        } else if (this.type === "lightning" || this.type === "rain") {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.fillStyle = "white";
            ctx.globalAlpha = 0.6;
            ctx.fillRect(this.x + 2, this.y + 2, this.w - 4, this.h - 4);
        } else if (this.type === "flame") {
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#f39c12";
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 3, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === "fishhook") {
            // Draw a hook shape
            ctx.strokeStyle = colors["fishhook"];
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x + 6, this.y + 6, 6, Math.PI, 0);
            ctx.lineTo(this.x + 12, this.y + 12);
            ctx.stroke();
            // Line trailing back
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + 6);
            ctx.lineTo(this.x - 20, this.y + 6);
            ctx.strokeStyle = "rgba(255,255,255,0.4)";
            ctx.lineWidth = 1;
            ctx.stroke();
        } else if (this.type === "capsule") {
            // Purple Haze virus capsule - circle with crack lines
            ctx.beginPath();
            ctx.arc(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#c0392b";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x + 3, this.y + 8);
            ctx.lineTo(this.x + 13, this.y + 8);
            ctx.stroke();
        } else if (this.type === "sand") {
            // Sand blade - triangular shard
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + this.h);
            ctx.lineTo(this.x + this.w / 2, this.y);
            ctx.lineTo(this.x + this.w, this.y + this.h);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
        }
        ctx.restore();
    }
}

// ============================================================
// AI CONTROLLER
// ============================================================
class AIController {
    constructor(aiPlayer, difficulty) {
        this.ai = aiPlayer;       // the Player instance the AI controls
        this.difficulty = difficulty;

        // Difficulty tuning knobs
        const cfg = {
            easy:   { reactionDelay: 55, attackRange: 160, jumpChance: 0.004, specialChance: 0.003, retreatHP: 0,   aggroDist: 250, mistakeChance: 0.35 },
            medium: { reactionDelay: 28, attackRange: 180, jumpChance: 0.008, specialChance: 0.012, retreatHP: 0.3, aggroDist: 320, mistakeChance: 0.15 },
            hard:   { reactionDelay: 10, attackRange: 200, jumpChance: 0.015, specialChance: 0.030, retreatHP: 0.2, aggroDist: 400, mistakeChance: 0.04 },
        };
        this.cfg = cfg[difficulty];

        this.actionTimer = 0;       // frames until AI can react again
        this.currentAction = null;  // what the AI is doing right now
        this.actionDuration = 0;    // how many frames to hold current action
        this.jumpCooldown = 0;
    }

    // Simulate pressing a key for the AI's fake controls
    press(ctrl) { keys[this.ai.controls[ctrl]] = true; }
    release(ctrl) { keys[this.ai.controls[ctrl]] = false; }
    releaseAll() {
        ['left','right','up','attack','special'].forEach(k => keys[this.ai.controls[k]] = false);
    }

    update(opponent) {
        if (!gameRunning) return;
        if (this.ai.stunned > 0 || (timeStopped && timeStopperId !== this.ai.id)) {
            this.releaseAll();
            return;
        }

        // Reaction delay — AI doesn't respond every single frame
        if (this.actionTimer > 0) { this.actionTimer--; return; }
        this.actionTimer = this.cfg.reactionDelay;

        // Random mistakes to make AI feel human
        if (Math.random() < this.cfg.mistakeChance) {
            this.releaseAll();
            return;
        }

        this.releaseAll(); // reset inputs before deciding

        const dist = Math.abs(this.ai.x - opponent.x);
        const isLeft = this.ai.x > opponent.x;
        const hpRatio = this.ai.hp / this.ai.data.hp;
        const isRanged = this.ai.data.type === 'ranged';

        // ── SPECIAL MOVE ──────────────────────────
        if (this.ai.sp >= 100 && Math.random() < this.cfg.specialChance) {
            this.press('special');
            return;
        }

        // ── RETREAT if low hp (medium/hard only) ──
        if (hpRatio < this.cfg.retreatHP && dist < 200) {
            isLeft ? this.press('right') : this.press('left');
            // Jump away sometimes
            if (!this.ai.isJumping && this.jumpCooldown <= 0 && Math.random() < 0.3) {
                this.press('up');
                this.jumpCooldown = 60;
            }
            return;
        }

        // ── RANGED characters: preferred attack distance ──
        if (isRanged) {
            const preferDist = 300;
            if (dist > preferDist + 60) {
                // Move closer
                isLeft ? this.press('left') : this.press('right');
            } else if (dist < preferDist - 60) {
                // Too close, back off a little
                isLeft ? this.press('right') : this.press('left');
            }
            // Fire if in range
            if (dist < preferDist + 100 && this.ai.attackCD <= 0) {
                this.press('attack');
            }
        } else {
            // ── MELEE characters: rush in ──
            if (dist > this.cfg.attackRange) {
                isLeft ? this.press('left') : this.press('right');
            } else {
                // In range — attack
                if (this.ai.attackCD <= 0) this.press('attack');
            }
        }

        // ── JUMPING ──────────────────────────────
        if (this.jumpCooldown > 0) this.jumpCooldown--;
        if (!this.ai.isJumping && this.jumpCooldown <= 0) {
            // Jump to close distance or dodge
            const shouldJump =
                (dist > this.cfg.aggroDist && Math.random() < this.cfg.jumpChance * 3) ||
                (Math.random() < this.cfg.jumpChance);
            if (shouldJump) {
                this.press('up');
                this.jumpCooldown = 50;
            }
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
