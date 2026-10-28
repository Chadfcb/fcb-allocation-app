// Tanks 3D scene (FCB-Data). Ported from the approved "FCB Tanks Preview" artifact
// (v40, 2026-10-05) — every look and decision is logged in the project docs
// claude/tank-view-direction.md and claude/tank-floor-layout.md.
//
// Plain JavaScript on purpose: it is the preview's code nearly line for line, so the app
// looks exactly like the approved preview. TanksClient.tsx mounts it and draws the
// details card.
//
// DATA: until the Ekos tank sync is built, the tank list + levels are the snapshot from
// the Ekos tank map Chad shared on 2026-10-03. Full tanks show "Fermenting"; FV16 shows
// a sample batch at the "Carbonating" stage (with sample tasks, days and temps) so the
// hover snapshot and stage visuals can be seen. Temps on every tank are samples.
//
// LIVE DATA (2026-10-05, claude/tank-sync-plan.md): once the Ekos tank sync has
// run, `live` (rows of table ekos_tanks) replaces all of the above — levels,
// products, batches, stage, yeast/dry hop, temps, overdue signs and each
// tank's tasks left for the hover snapshot.
//
// KEG PALLETS (2026-10-06, claude/tanks-keg-pallets-plan.md): `kegs` = { half, sixth } —
// 1/2 and 1/6 bbl kegs On Hand from Inventory & Allocation → Packaging Inventory (current
// week). Drawn on wooden pallets in line with the back row, right of CID-3.
// CAN + LID PALLETS (2026-10-06, claude/tanks-can-pallets-plan.md / tanks-lid-pallets-plan.md):
// `cans` = { c19, c16, c12 } and `lids` = individual On Hand counts; every can and every
// 500-lid chute is drawn, continuing the back-row line right of the kegs.
// COUNT WINDOWS (2026-10-06, claude/tanks-count-windows-plan.md): one always-visible window
// per item above its pallets, all on one line in the air, facing the camera.
// LABEL RACK (2026-10-06, claude/tanks-label-shelf-plan.md): `labels` = [{ name, size: 'c19' |
// 'c16' | 'c12', onHand }] from Label Inventory; plain steel rack, rolls of 2,000 lying flat,
// one stack per product; one window per shelf listing every brand + its labels.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createTankScene({ canvas, snapEl, onSelect, font, mono, live, kegs, cans, lids, labels }){
  const FONT = font || 'system-ui, sans-serif';
  const MONO = mono || 'ui-monospace, "SFMono-Regular", Consolas, monospace';
  let disposed = false;

  // ---------- Real tank sizes (inches → feet). Scene units = feet. ----------
  const SIZES = {
    7:  { dia:43.5, h:95    },   // G.W. Kent 7 BBL unitank
    30: { dia:63,   h:157.5 },   // G.W. Kent 30 BBL unitank
    60: { dia:68.9, h:173.8 },   // Allied Beverage Tanks FV-60BBL
  };
  // ---------- Cellar layout + contents (from the Ekos tank map Chad shared, Oct 3 2026) ----------
  // px = circle centers on that map; spacing is the map's, not measured.
  const TANKS = [
    { name:'FV06', bbl:60, px:67,  py:85 },
    { name:'FV05', bbl:30, px:190, py:80,  vol:9.657629,  code:'CHZY', product:'Captain Save A Hop Hazy IPA',   batch:'#1299 Captain Hazy', color:'#2B5FDC' },
    { name:'FV04', bbl:30, px:299, py:78 },
    { name:'FV03', bbl:30, px:409, py:80,  vol:14.12,     code:'CHZY', product:'Captain Save A Hop Hazy IPA',   batch:'#1303 15bbl hazy',   color:'#2563EB' },
    { name:'FV02', bbl:30, px:518, py:78,  vol:17.368684, code:'PV', product:'Peachy Vibes',     batch:'1298 Peachy Vibes',  color:'#EF9A9A' },
    { name:'FV01', bbl:30, px:629, py:80,  vol:9.899968,  code:'BDIPA', product:'Big Daddy IPA',  batch:'1301 BDIPA',         color:'#B5D6A7' },
    { name:'CID-1', bbl:7, px:760, py:68,  vol:7,         code:'BDIPA', product:'Big Daddy IPA',  batch:'1301 BDIPA 1',       color:'#B5D6A7' },
    { name:'CID-2', bbl:7, px:838, py:68,  vol:4.5,       code:'LTL', product:'Lime 30 Lager',    batch:'#1302 Lime 30.1',    color:'#22DD22' },
    { name:'CID-3', bbl:7, px:917, py:68,  vol:6,         code:'THC', product:'The Hatchet (Cider)',    batch:'CID021',             color:'#00EEEE' },
    { name:'FV11', bbl:60, px:133, py:208 },
    { name:'FV10', bbl:60, px:265, py:207 },
    { name:'FV9',  bbl:60, px:445, py:212 },
    { name:'FV08', bbl:60, px:577, py:212 },
    { name:'FV07', bbl:30, px:704, py:205, vol:22.548387, code:'VICTOR', product:'Victory Vibes', batch:'#1302 Lime 30',      color:'#C8F000' },
    { name:'FV18', bbl:30, px:815, py:203 },
    { name:'FV17', bbl:60, px:131, py:343 },
    { name:'FV14', bbl:60, px:263, py:342 },
    { name:'FV13', bbl:60, px:394, py:345 },
    { name:'FV12', bbl:60, px:523, py:345 },
    { name:'FV16', bbl:30, px:646, py:337, vol:18.662471, code:'NPT', product:'Nectarine Pie of the Tiger',    batch:'1295',               color:'#FFAE6B' },
    { name:'FV15', bbl:60, px:767, py:340 },
  ];
  // Real building (Chad, 2026-10-26 — claude/building-front-photo.md): 620 F St is a brick
  // box ≈ 51 ft wide (F St front) × 132 ft deep. Chad marked FRONT / BACK on a screenshot of
  // this view: the building's long side runs along the tank rows — the FRONT door is at the
  // packaging end (+x), the BACK wall is past FV06/FV11/FV17 (−x), the back row of tanks +
  // the packaging run along the far long wall (−z) and the near side (+z) is the open aisle.
  // Same arrangement as before; spacing tightened from 0.135 to the Ekos map's own scale
  // (≈ 0.06 ft per map pixel) so tanks + packaging fit inside the 132 ft.
  // BLD_W / BLD_D / IN_X / IN_Z are the building's own width / depth; in the scene the depth
  // runs along x and the width along z (the building is turned a quarter turn — see bld).
  const BLD_W = 58, BLD_D = 150, WALL_T = 0.75;   // Fresno County parcel map: APN 467-081-09 = 58 × 150 ft rectangle, building fills the lot (Chad: "58 ft")
  const IN_X = BLD_W/2 - WALL_T, IN_Z = BLD_D/2 - WALL_T;   // inside faces of the walls (building's own frame)
  const FT_PER_PX = 0.09, CX = 571, CZ = 322;               // 0.09 (Chad: "the cellar guy cant walk between tanks") → 3½–6 ft between tanks; ≈ 26 ft open floor behind the back tanks (Chad's floor plan); back row ≈ 2½ ft off the far wall

  // ---------- Beer looks (Chad, 2026-10-05): one standard beer color for everything, either
  // clear or hazy; ciders a bit redder (apple juice) and clear; Prohibition a deep red, clear.
  // The Ekos color stays only as the little dot on the label/card.
  const LOOKS = {
    clear:       { color:'#E3A033', opacity:0.55, glow:0.16 },
    hazy:        { color:'#E3A033', opacity:0.94, glow:0.26 },
    cider:       { color:'#D2733A', opacity:0.55, glow:0.16 },
    prohibition: { color:'#8A2614', opacity:0.62, glow:0.14 },
  };
  function lookFor(product){
    const p = (product || '').toLowerCase();
    if (/cider|hatchet|pitchfork|sickle/.test(p)) return 'cider';
    if (/prohibition/.test(p)) return 'prohibition';
    if (/hazy|juicy|mystic|nectarine|mango|peachy/.test(p)) return 'hazy';
    return 'clear';            // WC, Big Daddy, Lime 30, Victory Vibes, anything else
  }

  // ---------- Renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b100e, 160, 340);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
  camera.position.set(0, 78, 126);   // outside the open-aisle side, looking in over that wall at the tanks (2026-10-26)

  scene.add(new THREE.HemisphereLight(0xdfeee6, 0x0b100e, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(30, 50, 35); scene.add(key);
  // Overhead cellar lights (Chad's idea, 2026-10-04): a row of lights up near the ceiling gives
  // the polished steel crisp shine/hotspots, all lit from the same place like a real cellar.
  for (const [x, z] of [[-40, -12], [-18, -12], [4, -12], [26, -12], [52, -18], [-40, 20]]){   // over the tanks + the packaging, inside the building
    const lamp = new THREE.PointLight(0xfff6e8, 0.42, 110, 1.2); lamp.position.set(x, 32, z); scene.add(lamp);
  }
  const rim = new THREE.DirectionalLight(0x9fd88a, 0.35); rim.position.set(-35, 25, -30); scene.add(rim);

  // Concrete floor: solid gray with a slight speckle + soft patches (drawn here, no image file)
  function concreteTex(){
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.fillStyle = '#6a6e6b'; g.fillRect(0,0,N,N);
    let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i=0;i<260;i++){                      // soft light/dark patches (trowel marks, wear)
      const x = rnd()*N, y = rnd()*N, r = 20 + rnd()*90, light = rnd() > 0.5;
      for (const [dx,dy] of [[0,0],[N,0],[-N,0],[0,N],[0,-N]]){
        const gr = g.createRadialGradient(x+dx,y+dy,0,x+dx,y+dy,r);
        gr.addColorStop(0, light ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)'); gr.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x+dx-r,y+dy-r,r*2,r*2);
      }
    }
    const img = g.getImageData(0,0,N,N), d = img.data;   // fine grain
    for (let i=0;i<d.length;i+=4){ const n = (rnd()-0.5)*16; d[i]+=n; d[i+1]+=n; d[i+2]+=n; }
    g.putImageData(img,0,0);
    for (let i=0;i<900;i++){                       // tiny aggregate specks
      const x = rnd()*N, y = rnd()*N, r = 0.6 + rnd()*1.4;
      g.fillStyle = rnd() > 0.5 ? 'rgba(30,32,31,0.35)' : 'rgba(210,212,208,0.25)';
      g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const floorTex = concreteTex(); floorTex.repeat.set(700/14, 700/14);   // one texture tile ≈ 14 ft
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ map:floorTex, color:0x5c605e, roughness:0.92, metalness:0 }));
  floor.rotation.x = -Math.PI/2; scene.add(floor);
  function radialTex(inner, outer){
    const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d');
    const gr=g.createRadialGradient(128,128,0,128,128,128); gr.addColorStop(0,inner); gr.addColorStop(1,outer);
    g.fillStyle=gr; g.fillRect(0,0,256,256); return new THREE.CanvasTexture(c);
  }
  const shadowTex = radialTex('rgba(0,0,0,0.55)','rgba(0,0,0,0)');
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45,1.52,96), new THREE.MeshBasicMaterial({ color:0x6abc46, transparent:true, opacity:0, depthWrite:false, side:THREE.DoubleSide }));
  ring.rotation.x = -Math.PI/2; ring.position.y = 0.04; scene.add(ring);

  // ---------- The building (Chad, 2026-10-26 — claude/building-front-photo.md) ----------
  // 620 F St: brick box ≈ 51 × 132 ft, no roof drawn (so the top-down view still works).
  // Front (F St, +z): red brick, 17 ft side wings, a 21 ft centre tower with a recessed panel +
  // round emblem, the silver roll-up door (partly down) over an open storefront with black
  // swing gates, two black sign boxes with gooseneck lights, the maroon steel man door, white
  // efflorescence along the bottom. Back (-z): brick painted mustard yellow, "FULL CIRCLE
  // BREWING CO." across the top, a light gray roll-up door, a second (open) doorway and a tall
  // narrow window. Both long sides: plain brick with three wall lights (Chad: "the other side,
  // looks exactly like this side"). Sizes measured from Chad's photos (man door = 3 × 7 ft) and
  // Google satellite (≈ ±3 ft).
  // Any wall between the camera and the inside fades to see-through (like The Sims), so the
  // tanks are always visible; walls you're looking at from inside stay solid brick.
  const BRICK_TILE = 8, unitBox = new THREE.BoxGeometry(1, 1, 1);                       // one texture tile = 8 × 8 ft of wall
  function brickTex(painted){
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    let seed = painted ? 23 : 5; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    const COURSE = N/32, LEN = N/12, M = 4;  // 2⅔" bricks + ⅜" mortar → 32 courses per 8 ft; 8" long
    g.fillStyle = painted ? '#8f7a2e' : '#b3aa9b'; g.fillRect(0, 0, N, N);   // mortar
    for (let r=0;r<32;r++){
      const off = r % 2 ? LEN/2 : 0;
      for (let i=-1;i<13;i++){
        const x = i*LEN + off, y = r*COURSE;
        let col;
        if (painted){ const l = 41 + rnd()*5; col = 'hsl(' + (45 + rnd()*3) + ',' + (50 + rnd()*7) + '%,' + l + '%)'; }   // muted mustard (Chad's photo)
        else { const h = 8 + rnd()*12, sat = 42 + rnd()*20, l = 30 + rnd()*14 + (rnd() > 0.93 ? -8 : 0); col = 'hsl(' + h + ',' + sat + '%,' + l + '%)'; }
        g.fillStyle = col; g.fillRect(x + M/2, y + M/2, LEN - M, COURSE - M);
        if (!painted && rnd() > 0.6){            // a little texture on some bricks
          g.fillStyle = 'rgba(0,0,0,' + (0.05 + rnd()*0.1) + ')'; g.fillRect(x + M/2 + rnd()*LEN*0.6, y + M/2, LEN*0.3, COURSE - M);
        }
      }
    }
    const img = g.getImageData(0, 0, N, N), d = img.data;   // fine grain
    for (let i=0;i<d.length;i+=4){ const n = (rnd() - 0.5)*(painted ? 10 : 18); d[i] += n; d[i+1] += n; d[i+2] += n; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const brickRedTex = brickTex(false), brickYellowTex = brickTex(true);
  // Box with UVs taken from its place in the world, so bricks line up across every piece of wall
  function wallBox(mat, x0, x1, y0, y1, z0, z1){
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    geo.translate((x0 + x1)/2, (y0 + y1)/2, (z0 + z1)/2);
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i=0;i<pos.count;i++){
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      if (ny > 0.5) uv.setXY(i, x/BRICK_TILE, z/BRICK_TILE);
      else uv.setXY(i, (nx > 0.5 ? z : x)/BRICK_TILE, y/BRICK_TILE);
    }
    return new THREE.Mesh(geo, mat);
  }
  // Each wall fades on its own, so each gets its own copies of the materials it uses
  const walls = [];
  const bld = new THREE.Group(); bld.rotation.y = Math.PI/2; scene.add(bld);   // building's front (+z) faces scene +x
  const toBld = (p, o = {}) => { o.x = -p.z; o.y = p.y; o.z = p.x; return o; };  // scene point → building's own frame
  function makeWall(name, outside){
    const w = { name, outside, group: new THREE.Group(), mats: new Map(), op: 1 };
    w.mat = base => { if (!w.mats.has(base)){ const m = base.clone(); m.userData.baseOp = base.opacity; m.userData.baseTr = base.transparent; m.userData.baseDW = base.depthWrite; w.mats.set(base, m); } return w.mats.get(base); };
    w.box = (base, x0, x1, y0, y1, z0, z1) => { const m = wallBox(Array.isArray(base) ? base.map(w.mat) : w.mat(base), x0, x1, y0, y1, z0, z1); w.group.add(m); return m; };
    w.add = (geo, base, x, y, z) => { const m = new THREE.Mesh(geo, w.mat(base)); m.position.set(x, y, z); w.group.add(m); return m; };
    bld.add(w.group); walls.push(w);
    return w;
  }
  const L = h => new THREE.Color(h).convertSRGBToLinear();
  const brickMat = new THREE.MeshStandardMaterial({ map: brickRedTex, color: 0xffffff, roughness: 0.92, metalness: 0 });
  const yellowPaint = new THREE.MeshStandardMaterial({ map: brickYellowTex, color: 0xffffff, roughness: 0.85, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: L('#9a948a'), roughness: 0.9, metalness: 0 });
  const blackMat = new THREE.MeshStandardMaterial({ color: L('#141615'), roughness: 0.6, metalness: 0.2 });
  const metalMat = new THREE.MeshStandardMaterial({ color: L('#3a3d3c'), roughness: 0.5, metalness: 0.6 });
  const doorRedMat = new THREE.MeshStandardMaterial({ color: L('#5e2620'), roughness: 0.55, metalness: 0.35 });
  const lampMat = new THREE.MeshStandardMaterial({ color: L('#202322'), roughness: 0.5, metalness: 0.5, emissive: L('#fff1d0'), emissiveIntensity: 0 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6 });
  const whiteBoxMat = new THREE.MeshStandardMaterial({ color: L('#d9d9d4'), roughness: 0.6, metalness: 0 });
  function slatTex(light){        // roll-up door: horizontal slats
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = light ? '#c9cbc8' : '#9fa3a1'; g.fillRect(0, 0, 64, 256);
    for (let y=0;y<256;y+=16){ g.fillStyle = light ? '#a4a7a4' : '#7a7e7c'; g.fillRect(0, y, 64, 3); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y + 4, 64, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; return t;
  }
  const slatFrontTex = slatTex(false), slatBackTex = slatTex(true);
  function canvasTex(w, h, draw){
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }
  // flat picture on a wall (signs, lettering, staining); faceOut = which way it faces
  function decal(w, tex, x, y, z, width, height, faceOut, opts = {}){
    const base = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: opts.rough ?? 0.8, metalness: 0,
      emissive: opts.glow ? 0xffffff : 0x000000, emissiveMap: opts.glow ? tex : null, emissiveIntensity: opts.glow || 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), w.mat(base));
    m.position.set(x, y, z);
    m.rotation.y = { '+z': 0, '-z': Math.PI, '+x': Math.PI/2, '-x': -Math.PI/2 }[faceOut];
    w.group.add(m); return m;
  }
  // gooseneck wall light: arm out from the wall, curved down, shade + warm bulb
  function gooseneck(w, x, y, z, faceOut){
    const n = { '+z': [0, 1], '-z': [0, -1], '+x': [1, 0], '-x': [-1, 0] }[faceOut];
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(n[0], n[1]);   // local +z = out from the wall
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 8), w.mat(lampMat)); rod.rotation.x = Math.PI/2; rod.position.set(0, 0, 0.4); g.add(rod);
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 8), w.mat(lampMat)); drop.position.set(0, -0.1, 0.78); g.add(drop);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.32, 16, 1, true), w.mat(lampMat)); shade.position.set(0, -0.3, 0.78); g.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), w.mat(bulbMat)); bulb.position.set(0, -0.42, 0.78); g.add(bulb);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), w.mat(lampMat)); plate.rotation.x = Math.PI/2; plate.position.set(0, 0, 0.03); g.add(plate);
    w.group.add(g); return g;
  }
  const HF = BLD_D/2, HW = BLD_W/2, T = WALL_T;
  const WING_H = 17, TOWER_H = 21;

  // ----- FRONT (F St), outer face at z = +HF -----
  {
    const w = makeWall('front', p => p.z - HF);
    const z0 = HF - T, z1 = HF, zt = HF + 0.4;                       // tower stands 0.4 ft proud
    const fx = f => -HW + f*BLD_W;                                    // across the front, as a fraction of the width (from Chad's street photo)
    const TX0 = fx(0.294), TX1 = fx(0.643), RX0 = fx(0.466) - 5, RX1 = fx(0.466) + 5, RU_H = 13;   // tower + 10 ft roll-up opening
    const DX0 = fx(0.91) - 1.5, DX1 = fx(0.91) + 1.5, D_H = 7;                                     // 3 × 7 man door
    w.box(brickMat, -HW, TX0, 0, WING_H, z0, z1);                    // left wing
    w.box(brickMat, TX0, RX0, 0, TOWER_H, z0, zt);                   // tower, left of the roll-up
    w.box(brickMat, RX1, TX1, 0, TOWER_H, z0, zt);                   // tower, right of the roll-up
    w.box(brickMat, RX0, RX1, RU_H, TOWER_H, z0, zt);                // over the roll-up
    w.box(brickMat, TX1, DX0, 0, WING_H, z0, z1);                    // right wing
    w.box(brickMat, DX0, DX1, D_H, WING_H, z0, z1);                  // over the man door
    w.box(brickMat, DX1, HW, 0, WING_H, z0, z1);
    w.box(brickMat, HW - 1.2, HW, 0, WING_H + 0.3, z1, z1 + 0.25);   // corner pilaster
    // parapet caps
    w.box(capMat, -HW - 0.05, TX0, WING_H, WING_H + 0.25, z0 - 0.05, z1 + 0.08);
    w.box(capMat, TX1, HW + 0.05, WING_H, WING_H + 0.25, z0 - 0.05, z1 + 0.08);
    w.box(capMat, TX0 - 0.05, TX1 + 0.05, TOWER_H, TOWER_H + 0.3, z0 - 0.05, zt + 0.1);
    // recessed panel at the top of the tower: a brick frame stands out around it
    const PX0 = RX0 - 0.5, PX1 = RX1 + 0.5, PY0 = 14.3, PY1 = 20.0, F = 0.55, zp = zt + 0.22;
    w.box(brickMat, PX0, PX1, PY1 - F, PY1, zt, zp); w.box(brickMat, PX0, PX1, PY0, PY0 + F, zt, zp);
    w.box(brickMat, PX0, PX0 + F, PY0, PY1, zt, zp); w.box(brickMat, PX1 - F, PX1, PY0, PY1, zt, zp);
    // round emblem in the middle of the panel
    const emb = w.add(new THREE.CylinderGeometry(0.95, 0.95, 0.18, 32), capMat, (PX0 + PX1)/2, (PY0 + PY1)/2, zt + 0.1); emb.rotation.x = Math.PI/2;
    const embIn = w.add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 32), new THREE.MeshStandardMaterial({ color: L('#6f675d'), roughness: 0.9 }), (PX0 + PX1)/2, (PY0 + PY1)/2, zt + 0.12); embIn.rotation.x = Math.PI/2;
    // concrete bands either side of the roll-up head
    w.box(capMat, TX0 - 0.02, RX0, RU_H - 0.45, RU_H + 0.35, zt, zt + 0.12);
    w.box(capMat, RX1, TX1 + 0.02, RU_H - 0.45, RU_H + 0.35, zt, zt + 0.12);
    // roll-up door: silver slats, rolled down to ≈ 9.4 ft (like the photo), open below
    const RU_BOT = 9.4, slat = slatFrontTex.clone(); slat.needsUpdate = true; slat.repeat.set(1, (RU_H - RU_BOT)/4);
    w.box(new THREE.MeshStandardMaterial({ map: slat, roughness: 0.45, metalness: 0.55 }), RX0, RX1, RU_BOT, RU_H, z0 + 0.25, z0 + 0.4);
    w.box(metalMat, RX0, RX1, RU_BOT - 0.15, RU_BOT, z0 + 0.22, z0 + 0.43);                // bottom bar
    // storefront frame under it (header + side posts), doors wide open
    w.box(metalMat, RX0 + 0.1, RX1 - 0.1, RU_BOT - 0.9, RU_BOT - 0.55, z0 + 0.1, z0 + 0.3);
    w.box(metalMat, RX0 + 0.1, RX0 + 0.4, 0, RU_BOT - 0.55, z0 + 0.1, z0 + 0.3);
    w.box(metalMat, RX1 - 0.4, RX1 - 0.1, 0, RU_BOT - 0.55, z0 + 0.1, z0 + 0.3);
    // black metal swing gates, swung open out toward the sidewalk
    for (const [hx, dir] of [[RX0 + 0.05, 1], [RX1 - 0.05, -1]]){
      const gate = new THREE.Group(); gate.position.set(hx, 0, zt + 0.05);
      const leafW = 2.6, leafH = 8.2;
      const bar = (x0, x1, y0, y1) => { const m = new THREE.Mesh(unitBox, w.mat(blackMat)); m.scale.set(0.09, y1 - y0, x1 - x0); m.position.set(0, (y0 + y1)/2, (x0 + x1)/2); gate.add(m); };
      bar(0, leafW, 0.25, 0.4); bar(0, leafW, leafH - 0.15, leafH); bar(0, leafW, 4.0, 4.12);
      for (let i=0;i<=8;i++){ const z = i*leafW/8; bar(Math.max(0, z - 0.04), Math.min(leafW, z + 0.04), 0.25, leafH); }
      gate.rotation.y = dir > 0 ? 0.25 : -0.25;
      w.group.add(gate);
    }
    // orange cones at the doorway
    const coneMat = new THREE.MeshStandardMaterial({ color: L('#e2584a'), roughness: 0.6 });
    for (const cx of [RX0 - 0.6, RX1 + 0.6]){ w.add(new THREE.ConeGeometry(0.42, 1.6, 16), coneMat, cx, 0.8, zt + 1.4); w.add(new THREE.BoxGeometry(1.0, 0.1, 1.0), coneMat, cx, 0.05, zt + 1.4); }
    // man door: maroon steel, set back a little, with a lever
    w.box(doorRedMat, DX0, DX1, 0, D_H, z0 + 0.2, z0 + 0.38);
    w.box(metalMat, DX0 - 0.15, DX0, 0, D_H + 0.15, z0, z1 + 0.05); w.box(metalMat, DX1, DX1 + 0.15, 0, D_H + 0.15, z0, z1 + 0.05);
    w.box(metalMat, DX0 - 0.15, DX1 + 0.15, D_H, D_H + 0.15, z0, z1 + 0.05);
    w.box(metalMat, DX0 + 0.25, DX0 + 0.75, 3.3, 3.42, z0 + 0.38, z0 + 0.5);
    // sign boxes: black frame, sign inside
    const neonTex = canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#0d0e10'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#5a1f1a'; g.fillRect(40, 40, W - 80, H - 80); g.fillStyle = '#121214'; g.fillRect(56, 56, W - 112, H - 112);
      g.shadowColor = '#ff6fa8'; g.shadowBlur = 18; g.fillStyle = '#ffb3d0'; g.textAlign = 'center';
      g.font = 'bold 54px ' + FONT; g.fillText('CRAFT', W/2 - 70, 170); g.fillText('BEER', W/2 - 70, 236);
      g.font = '600 30px ' + FONT; g.fillText('BREWED HERE', W/2 - 70, 300);
      g.shadowColor = '#bfefff'; g.strokeStyle = '#e9fbff'; g.lineWidth = 7;
      g.beginPath(); g.arc(W/2 + 110, 250, 62, 0, Math.PI*2); g.stroke();
      g.beginPath(); g.arc(W/2 + 88, 240, 13, 0, Math.PI*2); g.arc(W/2 + 132, 240, 13, 0, Math.PI*2); g.stroke();
    });
    const logoTex = canvasTex(512, 512, (g, W, H) => {
      g.fillStyle = '#0d0e10'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#5e231c'; g.fillRect(70, 70, W - 140, H - 140); g.fillStyle = '#16100d'; g.fillRect(86, 86, W - 172, H - 172);
      const cx = W/2, cy = H/2; g.strokeStyle = '#f1ede4'; g.fillStyle = '#f1ede4'; g.lineWidth = 6;
      g.beginPath(); g.arc(cx, cy, 128, 0, Math.PI*2); g.stroke();
      g.font = 'bold 26px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      const txt = 'FULL CIRCLE  BREWING CO  ·  ';
      for (let i=0;i<txt.length;i++){ const a = -Math.PI*0.95 + i/txt.length*Math.PI*2; g.save(); g.translate(cx + Math.cos(a)*104, cy + Math.sin(a)*104); g.rotate(a + Math.PI/2); g.fillText(txt[i], 0, 0); g.restore(); }
      // simple skull
      g.beginPath(); g.ellipse(cx, cy - 6, 52, 48, 0, 0, Math.PI*2); g.fill(); g.fillRect(cx - 32, cy + 24, 64, 34);
      g.fillStyle = '#16100d'; g.beginPath(); g.ellipse(cx - 21, cy - 4, 15, 17, 0, 0, Math.PI*2); g.ellipse(cx + 21, cy - 4, 15, 17, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.moveTo(cx, cy + 12); g.lineTo(cx - 8, cy + 26); g.lineTo(cx + 8, cy + 26); g.fill();
      for (let i=-2;i<=2;i++) g.fillRect(cx + i*12 - 1.5, cy + 36, 3, 22);
    });
    for (const [cx, tex, glow] of [[fx(0.186), neonTex, 0.9], [fx(0.747), logoTex, 0.15]]){
      const y0 = 6, S = 5;
      w.box(blackMat, cx - S/2, cx + S/2, y0, y0 + S, z1, z1 + 0.35);
      decal(w, tex, cx, y0 + S/2, z1 + 0.37, S - 0.4, S - 0.4, '+z', { glow, rough: 0.5 });
      gooseneck(w, cx, y0 + S + 3.3, z1, '+z');
    }
    w.box(whiteBoxMat, fx(0.86) - 0.55, fx(0.86) + 0.55, 13.0, 14.3, z1, z1 + 0.35);         // small white box high near the right corner
    // white efflorescence along the bottom of the brick (not over the doorways)
    const effTex = canvasTex(2048, 256, (g, W, H) => {
      let sd = 31; const r = () => (sd = (sd*16807) % 2147483647) / 2147483647;
      for (let i=0;i<260;i++){
        const x = r()*W, y = H - r()*r()*H*0.95, rad = 8 + r()*34;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(236,234,228,' + (0.10 + r()*0.22) + ')'); gr.addColorStop(1, 'rgba(236,234,228,0)');
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad*2, rad*2);
      }
    });
    const EFF_H = 5.2;
    for (const [a, b, zz] of [[-HW, TX0, z1], [TX0, RX0, zt], [RX1, TX1, zt], [TX1, DX0, z1], [DX1, HW - 1.2, z1]]){
      const tex = effTex.clone(); tex.needsUpdate = true; tex.repeat.set((b - a)/BLD_W, 1); tex.offset.set((a + HW)/BLD_W, 0);
      decal(w, tex, (a + b)/2, EFF_H/2, zz + 0.01, b - a, EFF_H, '+z', { rough: 0.95 });
    }
  }

  // ----- BACK (alley side), outer face at z = -HF — painted mustard yellow -----
  {
    const w = makeWall('back', p => -HF - p.z);
    const z0 = -HF, z1 = -HF + T, H = WING_H;
    const yellowMat = [yellowPaint, yellowPaint, yellowPaint, yellowPaint, brickMat, yellowPaint];   // painted outside, plain brick inside
    // seen from outside (looking toward the front), +x is on your LEFT
    // Chad's floor plan: two roll-up doors on the tank side, a man door past them. Photo: the one by
    // the corner is closed (light gray), the other is raised (open). Building +x = tank side.
    const RU0 = 12.4, RU1 = 22.4, RU_H = 12;   // closed light gray roll-up
    const OP0 = -6.8, OP1 = 2.2, OP_H = 12;    // second roll-up, raised → open doorway
    const MD0 = -14.3, MD1 = -11.3, MD_H = 7;  // man door
    w.box(yellowMat, -HW, HW, RU_H, H, z0, z1);                      // band over the doors
    w.box(yellowMat, RU1, HW, 0, RU_H, z0, z1);
    w.box(yellowMat, OP1, RU0, 0, RU_H, z0, z1);
    w.box(yellowMat, MD1, OP0, 0, RU_H, z0, z1);
    w.box(yellowMat, MD0, MD1, MD_H, RU_H, z0, z1);
    w.box(yellowMat, -HW, MD0, 0, RU_H, z0, z1);
    w.box(capMat, -HW - 0.05, HW + 0.05, H, H + 0.25, z0 - 0.08, z1 + 0.05);
    const slat = slatBackTex.clone(); slat.needsUpdate = true; slat.repeat.set(1, RU_H/4);
    w.box(new THREE.MeshStandardMaterial({ map: slat, roughness: 0.5, metalness: 0.3 }), RU0, RU1, 0, RU_H, z0 + 0.3, z0 + 0.45);
    w.box(metalMat, RU0 - 0.2, RU0, 0, RU_H, z0 - 0.05, z1); w.box(metalMat, RU1, RU1 + 0.2, 0, RU_H, z0 - 0.05, z1);
    w.box(metalMat, OP0 - 0.2, OP0, 0, OP_H, z0 - 0.05, z1); w.box(metalMat, OP1, OP1 + 0.2, 0, OP_H, z0 - 0.05, z1);
    w.box(new THREE.MeshStandardMaterial({ map: slatBackTex, roughness: 0.5, metalness: 0.3 }), OP0, OP1, OP_H - 0.9, OP_H, z0 + 0.3, z0 + 0.45);   // raised door showing at the top
    w.box(doorRedMat, MD0, MD1, 0, MD_H, z0 + 0.2, z0 + 0.38);                                     // steel man door
    w.box(metalMat, MD0 - 0.15, MD0, 0, MD_H + 0.15, z0 - 0.05, z1); w.box(metalMat, MD1, MD1 + 0.15, 0, MD_H + 0.15, z0 - 0.05, z1);
    w.box(metalMat, MD0 - 0.15, MD1 + 0.15, MD_H, MD_H + 0.15, z0 - 0.05, z1);
    const letters = canvasTex(2048, 160, (g, W, Hh) => {
      g.fillStyle = '#2b1e13'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 132px "Arial Narrow", "Roboto Condensed", Impact, ' + FONT;
      g.fillText('FULL CIRCLE BREWING CO.', W/2, Hh/2 + 6, W - 40);
      g.globalCompositeOperation = 'destination-out';           // weathered paint
      let sd = 9; const r = () => (sd = (sd*16807) % 2147483647) / 2147483647;
      for (let i=0;i<900;i++){ g.fillStyle = 'rgba(0,0,0,' + (0.2 + r()*0.5) + ')'; g.fillRect(r()*W, r()*Hh, 2 + r()*5, 1 + r()*3); }
    });
    decal(w, letters, 0, 14.6, z0 - 0.01, BLD_W - 5, 3.6*(BLD_W - 5)/46, '-z', { rough: 0.85 });
    gooseneck(w, -HW + 1.6, 15.6, z0, '-z');
  }

  // ----- SIDES: plain brick, three wall lights each (yard side = -x, gravel-lot side = +x) -----
  for (const [name, sx] of [['left', -1], ['right', 1]]){
    const w = makeWall(name, sx < 0 ? p => -HW - p.x : p => p.x - HW);
    const x0 = sx < 0 ? -HW : HW - T, x1 = sx < 0 ? -HW + T : HW;
    w.box(brickMat, x0, x1, 0, WING_H, -HF + T, HF - T);
    w.box(capMat, x0 - 0.05, x1 + 0.05, WING_H, WING_H + 0.25, -HF + T, HF - T);
    for (const z of [-55, 0, 55]) gooseneck(w, sx < 0 ? x0 : x1, 15.2, z, sx < 0 ? '-x' : '+x');
  }

  // sidewalk + street in front (F St)
  {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(BLD_W + 60, 9), new THREE.MeshStandardMaterial({ color: L('#8c8a84'), roughness: 0.95 }));
    side.rotation.x = -Math.PI/2; side.position.set(0, 0.012, HF + 4.5); bld.add(side);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(BLD_W + 400, 36), new THREE.MeshStandardMaterial({ color: L('#2c2e2d'), roughness: 0.95 }));
    street.rotation.x = -Math.PI/2; street.position.set(0, 0.008, HF + 9 + 18); bld.add(street);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(BLD_W + 60, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: L('#a19e96'), roughness: 0.9 }));
    curb.position.set(0, 0.25, HF + 9); bld.add(curb);
  }

  // ----- Rooms along the aisle-side wall at the back (Chad's floor plan, 2026-10-26) -----
  // Office, lab, bathrooms, storage in a row from the back wall, ≈ 47% of the length, ≈ 14 ft
  // deep, doors facing the brewery floor. 10 ft white walls, open top so you can look in.
  const ROOMS = { x0: -IN_Z, x1: -IN_Z + 0.47*BLD_D, z0: IN_X - 14, z1: IN_X, h: 10 };
  {
    const fxr = f => -IN_Z + f*BLD_D;   // along the building, from the back wall
    const wallMat = new THREE.MeshStandardMaterial({ color: L('#e7e4dc'), roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: L('#8d918f'), roughness: 0.6, metalness: 0.3 });
    const roomDoorMat = new THREE.MeshStandardMaterial({ color: L('#b9bcb8'), roughness: 0.5, metalness: 0.2 });
    const T2 = 0.4, { x0, x1, z0, z1, h } = ROOMS;
    const box = (mat, ax, bx, ay, by, az, bz) => { const m = new THREE.Mesh(unitBox, mat); m.scale.set(bx - ax, by - ay, bz - az); m.position.set((ax + bx)/2, (ay + by)/2, (az + bz)/2); scene.add(m); return m; };
    const rooms = [['OFFICE', 0, 0.09, 0.08], ['LAB', 0.09, 0.19, 0.11], ['RESTROOMS', 0.19, 0.34, 0.21], ['STORAGE', 0.34, 0.47, 0.44]];
    // front wall of the rooms, with a 3 × 7 door opening for each
    const doors = rooms.map(r => fxr(r[3])).sort((a, b) => a - b);
    let cur = x0;
    for (const dx of doors){
      box(wallMat, cur, dx - 1.5, 0, h, z0, z0 + T2);
      box(wallMat, dx - 1.5, dx + 1.5, 7, h, z0, z0 + T2);
      box(roomDoorMat, dx - 1.45, dx + 1.45, 0, 7, z0 + 0.1, z0 + 0.25);                // closed door
      box(trimMat, dx + 0.95, dx + 1.25, 3.3, 3.42, z0 - 0.06, z0 + 0.1);               // handle
      cur = dx + 1.5;
    }
    box(wallMat, cur, x1, 0, h, z0, z0 + T2);
    box(wallMat, x1 - T2, x1, 0, h, z0, z1);                                             // end wall
    for (const r of rooms.slice(1)) box(wallMat, fxr(r[1]) - T2/2, fxr(r[1]) + T2/2, 0, h, z0, z1);   // walls between rooms
    for (const r of rooms){                                                              // name plate over each door
      const tex = canvasTex(256, 64, (g, W, H) => { g.fillStyle = '#1d211f'; g.fillRect(0, 0, W, H); g.fillStyle = '#f2f2ee'; g.font = 'bold 34px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r[0], W/2, H/2 + 2); });
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      plate.position.set(fxr(r[3]), 7.7, z0 - 0.02); plate.rotation.y = Math.PI; scene.add(plate);
    }
    box(trimMat, x0, x1, h, h + 0.12, z0 - 0.05, z0 + T2 + 0.05);                       // top trim
  }

  // Fade a wall when it stands between the camera and what it's looking at inside: the camera
  // is outside that wall and the look-at point is inside it. Look at the building itself from
  // outside (slide the view so it's aimed at the wall) and the wall stays solid brick.
  const WALL_FADED = 0.25, wlP = {}, wlT = {};
  function updateWalls(dt){
    const p = toBld(camera.position, wlP), tg = toBld(controls.target, wlT);
    for (const w of walls){
      const out = fp.active ? -1 : Math.min(w.outside(p), -w.outside(tg) - 1);   // ft outside that wall's face (and target ≥ 1 ft inside it)
      const k = Math.min(1, Math.max(0, (out + 1)/5));
      const want = 1 - (1 - WALL_FADED)*k;
      if (Math.abs(want - w.op) < 1e-3 && w.done) continue;
      w.op += (want - w.op)*Math.min(1, dt*6); if (Math.abs(want - w.op) < 2e-3) w.op = want;
      w.done = w.op === want;
      const solid = w.op > 0.995;
      for (const m of w.mats.values()){
        m.opacity = m.userData.baseOp*w.op;
        const tr = m.userData.baseTr || !solid;
        if (m.transparent !== tr){ m.transparent = tr; m.needsUpdate = true; }
        m.depthWrite = solid ? m.userData.baseDW : false;
      }
    }
  }

  // Soft studio reflections, used only by the solid stainless (empty) tanks
  let steelEnv = null;
  // Polished stainless (Chad, 2026-10-04, from his Cedarstone tank photo): the steel reflects
  // a simple surrounding "room" — dark walls ringed with tall bright strips of different widths
  // and brightness — so the polished cylinders get crisp vertical white/gray streaks top to
  // bottom, plus ceiling light strips for the domes and a concrete floor for the bottoms.
  {
    const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 90, 48, 1, true), new THREE.MeshBasicMaterial({ color:0x4b514e, side:THREE.BackSide }));
    room.position.y = -15; env.add(room);   // tall, so tanks seen from above still reflect the strips (not the floor)
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color:0x8c9490 })); ceil.rotation.x = Math.PI/2; ceil.position.y = 24; env.add(ceil);
    const fl = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color:0x4a4f4c })); fl.rotation.x = -Math.PI/2; fl.position.y = -60; env.add(fl);
    const lightMat = new THREE.MeshBasicMaterial({ color:0xffffff });
    for (let i=-2;i<=2;i++){ const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 40), lightMat); strip.position.set(i*6, 23.5, 0); env.add(strip); }
    let seed = 11; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    const shades = [0xffffff, 0xe3e8e5, 0xc4cbc7, 0xa3aba7, 0x6f7773, 0x353a37];
    for (let k=0;k<15;k++){                                   // tall vertical bands all the way around: wide soft ones + a few crisp bright ones
      const ang = k/15*Math.PI*2 + rnd()*0.18, w = k%4 === 0 ? 0.7 : 2.5 + rnd()*5;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 84), new THREE.MeshBasicMaterial({ color:shades[(rnd()*shades.length)|0] }));
      strip.position.set(Math.sin(ang)*29.5, -15, Math.cos(ang)*29.5); strip.lookAt(0, -15, 0); env.add(strip);
    }
    steelEnv = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }
  // Real-looking hop cone (built once, shared) — modeled on Chad's reference photo:
  // pale yellow-green, rounded teardrop bracts overlapping in spiral rows like a pinecone,
  // fullest in the upper-middle, tapering to a point at the bottom, small stem on top.
  function makeHopConeGeometry(){
    const bract = new THREE.SphereGeometry(1, 10, 8).toNonIndexed();
    bract.translate(0, -0.55, 0);                         // pivot at the top edge so the bract hangs down like a scale
    const pos = [], nor = [], col = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const c = new THREE.Color();
    const ROWS = 10, PER = 6;
    const radAt = f => 0.05 + 0.33*Math.sin(Math.PI*Math.pow(f, 0.8)*0.95);   // f: 0 = bottom tip, 1 = top
    const addGeo = (g, color) => {
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let i=0;i<P.length;i++){ pos.push(P[i]); nor.push(N[i]); }
      for (let i=0;i<P.length/3;i++) col.push(color.r, color.g, color.b);
    };
    for (let r=0;r<ROWS;r++){
      const f = (r + 0.5)/ROWS, y = -0.5 + f;
      const rad = radAt(f);
      for (let k=0;k<PER;k++){
        const a = k/PER*Math.PI*2 + r*0.52;                // spiral offset per row → overlapping scales
        e.set(0.42, a, 0, 'YXZ'); q.setFromEuler(e);        // lower edge flares out, tips point down
        v.set(Math.sin(a)*rad*0.78, y + 0.05, Math.cos(a)*rad*0.78);
        const w = 0.10 + rad*0.42;
        sc.set(w, 0.13 + rad*0.12, 0.035);                  // rounded, thin, papery
        m.compose(v, q, sc);
        const g = bract.clone(); g.applyMatrix4(m);
        c.setHSL(0.205 + (Math.random()-0.5)*0.02, 0.55, 0.52 + f*0.08 + Math.random()*0.06).convertSRGBToLinear();
        addGeo(g, c);
      }
    }
    // a few loose pointed leaf tips sticking out at the sides
    const tip = new THREE.ConeGeometry(0.035, 0.16, 4).toNonIndexed();
    for (let k=0;k<5;k++){
      const a = k*1.37, f = 0.35 + 0.12*k, rad = radAt(f);
      e.set(1.9 + Math.random()*0.3, a, 0, 'YXZ'); q.setFromEuler(e);
      v.set(Math.sin(a)*rad*0.95, -0.5 + f, Math.cos(a)*rad*0.95); sc.set(1, 1, 1);
      m.compose(v, q, sc); const g = tip.clone(); g.applyMatrix4(m);
      addGeo(g, c.setHSL(0.21, 0.5, 0.6).convertSRGBToLinear());
    }
    // small stem + leafy bits on top
    const stem = new THREE.CylinderGeometry(0.022, 0.035, 0.16, 6).toNonIndexed(); stem.translate(0, 0.58, 0);
    addGeo(stem, c.set(0x6e8f34).convertSRGBToLinear());
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }
  const hopConeGeo = makeHopConeGeometry();
  const hopConeMat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.85, metalness:0, side:THREE.DoubleSide, emissive:new THREE.Color(0x1c2a0a).convertSRGBToLinear() });
  const HOPS_FLOAT = 120;  // packed full across the top of the beer, right up to the tank walls (Chad)

  // Shared materials / geometry
  const steel = new THREE.MeshStandardMaterial({ color:0xc4cbc7, metalness:1.0, roughness:0.22, envMap:steelEnv, envMapIntensity:1.0 });
  const steelDark = new THREE.MeshStandardMaterial({ color:0x8c948f, metalness:1.0, roughness:0.32, envMap:steelEnv, envMapIntensity:0.9 });
  const bandMat = new THREE.MeshBasicMaterial({ color:0x8fd16e, transparent:true, opacity:0.10, depthWrite:false, side:THREE.DoubleSide });
  const foamMat = new THREE.MeshStandardMaterial({ color:0xf3ead2, roughness:0.9, transparent:true, opacity:0.55, depthWrite:false });
  const popMat = new THREE.MeshStandardMaterial({ color:0xfffbef, roughness:0.15, metalness:0, transparent:true, opacity:0.55, emissive:0x3a3528, depthWrite:false });
  const popGeo = new THREE.SphereGeometry(1, 10, 8);
  const shellVS = `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
  const shellFS = `uniform vec3 uColor; uniform vec3 uGlow; uniform float uHover; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 c = mix(uColor, uGlow, 0.35 + 0.25*uHover);
        float a = 0.05 + f*(0.42 + 0.25*uHover);
        gl_FragColor = vec4(c, a); }`;
  function roundRect(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }

  const POP_N = 420, RISE_N = 240, STREAMS = 7, INSET = 0.975;
  const pickables = [];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- One tank = the approved example tank, stretched to its real height ----------
  // Built in "radius = 1" units exactly like the example, then scaled by the real radius in feet.
  function makeTank(spec){
    const S = SIZES[spec.bbl];
    const Rft = S.dia/2/12, Hft = S.h/12;
    const R = 1, TIP = 0.75, CONE = 1.15, DOME = 0.42, LID = 0.15;
    const CYL = Hft/Rft - (TIP + CONE + DOME + LID);       // only the straight wall changes per size
    const Y_CONE = TIP + CONE, Y_CYL = Y_CONE + CYL, Y_TOP = Y_CYL + DOME;
    const t = {
      spec, name:spec.name, capacity:spec.bbl, volume:spec.vol || 0, status: spec.vol ? 'Fermenting' : 'Empty',
      color: spec.color || '#888888', Rft, Hft, hover:0, hoverTarget:0,
    };
    const group = new THREE.Group();
    group.position.set((spec.px - CX)*FT_PER_PX, 0, (spec.py - CZ)*FT_PER_PX);
    group.scale.setScalar(Rft);
    scene.add(group); t.group = group;

    const profile = [];
    profile.push(new THREE.Vector2(0.09, TIP - 0.02));
    profile.push(new THREE.Vector2(0.12, TIP));
    for (let i=1;i<=6;i++){ const k=i/6; profile.push(new THREE.Vector2(0.12+(R-0.12)*k, TIP+CONE*k)); }
    for (let i=1;i<=8;i++){ profile.push(new THREE.Vector2(R, Y_CONE+CYL*i/8)); }
    for (let i=1;i<=10;i++){ const a=(i/10)*Math.PI/2; profile.push(new THREE.Vector2(Math.max(R*Math.cos(a),0.001), Y_CYL+DOME*Math.sin(a))); }
    const vCone = Math.PI*R*R*CONE/3, vCap = vCone + Math.PI*R*R*CYL;
    const heightFor = frac => { const v = Math.max(0, Math.min(1, frac)) * vCap;
      return v <= vCone ? TIP + CONE*Math.cbrt(v/vCone) : Y_CONE + (v - vCone)/(Math.PI*R*R); };
    const radiusAt = y => y <= TIP ? 0.12 : (y <= Y_CONE ? 0.12 + (R-0.12)*(y-TIP)/CONE : R);
    t.heightFor = heightFor; t.radiusAt = radiusAt; t.TIP = TIP;

    // Floor shadow
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4,3.4), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false }));
    shadow.rotation.x = -Math.PI/2; shadow.position.y = 0.025/Rft; group.add(shadow);

    // Liquid
    t.liquidMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.35, metalness:0, transparent:true, opacity:0.88, emissive:0x000000, depthWrite:false });
    t.liquid = new THREE.Mesh(new THREE.BufferGeometry(), t.liquidMat); t.liquid.renderOrder = 1; group.add(t.liquid);
    t.surfMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.2, transparent:true, opacity:0.95, emissive:0x000000 });
    t.surface = new THREE.Mesh(new THREE.CircleGeometry(1,64), t.surfMat); t.surface.rotation.x = -Math.PI/2; t.surface.renderOrder = 2; group.add(t.surface);
    t.foamMat = foamMat.clone(); t.popMat = popMat.clone();
    t.foam = new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,64,1,true), t.foamMat); t.foam.renderOrder = 2; group.add(t.foam);
    t.foamTopGeo = new THREE.RingGeometry(0.0001, 1, 72, 14);
    t.foamBase = t.foamTopGeo.attributes.position.array.slice();
    t.foamTop = new THREE.Mesh(t.foamTopGeo, t.foamMat); t.foamTop.rotation.x = -Math.PI/2; t.foamTop.renderOrder = 2; group.add(t.foamTop);
    t.pops = new THREE.InstancedMesh(popGeo, t.popMat, POP_N); t.pops.renderOrder = 2; t.pops.frustumCulled = false; group.add(t.pops);
    t.popState = Array.from({length:POP_N}, ()=>({ a:0, r:0, life:Math.random()*2.5, dur:1, size:0.03 }));
    const _zero = new THREE.Matrix4().makeScale(0,0,0); for (let i=0;i<POP_N;i++) t.pops.setMatrixAt(i, _zero);
    t.riseGeo = new THREE.BufferGeometry(); t.risePos = new Float32Array(RISE_N*3);
    t.riseGeo.setAttribute('position', new THREE.BufferAttribute(t.risePos, 3));
    const riseMat = new THREE.PointsMaterial({ color:0xfffbe8, size:0.045*Rft, sizeAttenuation:true, transparent:true, opacity:0.7, depthWrite:false });
    t.rising = new THREE.Points(t.riseGeo, riseMat); t.rising.renderOrder = 1.5; t.rising.frustumCulled = false; group.add(t.rising);
    // Dry hop: light-green hop particles sinking (same idea as the CO2 bubbles, going down)
    t.hopGeo = new THREE.BufferGeometry(); t.hopPos = new Float32Array(RISE_N*3);
    t.hopGeo.setAttribute('position', new THREE.BufferAttribute(t.hopPos, 3));
    t.sinking = new THREE.Points(t.hopGeo, new THREE.PointsMaterial({ color:new THREE.Color(0xb4e07a).convertSRGBToLinear(), size:0.05*Rft, sizeAttenuation:true, transparent:true, opacity:0.85, depthWrite:false }));
    t.sinking.renderOrder = 1.5; t.sinking.frustumCulled = false; t.sinking.visible = false; group.add(t.sinking);
    t.hopState = Array.from({length:RISE_N}, ()=>({ a: Math.random()*Math.PI*2, r: Math.sqrt(Math.random())*0.85, y: -1, v: 0.18 + Math.random()*0.22, w: Math.random()*6 }));
    // Dry hop: bigger sinking hop pieces in mixed sizes, same light green as the flecks (Chad)
    const CHUNK_N = 80;
    t.chunks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color:new THREE.Color(0xb4e07a).convertSRGBToLinear(), transparent:true, opacity:0.9, depthWrite:false }), CHUNK_N);
    t.chunks.renderOrder = 1.5; t.chunks.frustumCulled = false; t.chunks.visible = false; group.add(t.chunks);
    t.chunkState = Array.from({length:CHUNK_N}, ()=>{
      const size = 0.018 + 0.027*Math.pow(Math.random(), 1.8);          // mixed sizes, biggest now about half the old max (Chad: "some are too big")
      return { a: Math.random()*Math.PI*2, r: Math.sqrt(Math.random())*0.82, y: -1, size, v: 0.12 + size*2.6 + Math.random()*0.08,
               w: Math.random()*6, rx: Math.random()*6, ry: Math.random()*6, sx: (Math.random()-0.5)*2, sy: (Math.random()-0.5)*2 };
    });
    // Dry hop: a bunch of real hop cones floating at the top of the beer, each bobbing on its own
    t.floatHops = new THREE.InstancedMesh(hopConeGeo, hopConeMat, HOPS_FLOAT);
    t.floatHops.renderOrder = 2; t.floatHops.frustumCulled = false; t.floatHops.visible = false; group.add(t.floatHops);
    t.floatState = Array.from({length:HOPS_FLOAT}, (_,i)=>{
      const a = i*2.399963 + Math.random()*0.3, r = 0.03 + 0.97*Math.sqrt((i+0.5)/HOPS_FLOAT);   // packed out to the wall
      return { a, r, yaw: Math.random()*Math.PI*2, tilt: 1.2 + Math.random()*0.5, lift: Math.random()*0.04,
               size: 0.19 + Math.random()*0.07, f: 0.9 + Math.random()*0.8, ph: Math.random()*6 };
    });
    t.streams = Array.from({length:STREAMS}, (_,i)=>({ a: i/STREAMS*Math.PI*2 + Math.random()*0.5, r: 0.15 + Math.random()*0.55 }));
    t.riseState = Array.from({length:RISE_N}, (_,i)=>({ s: i % STREAMS, y: TIP + Math.random()*(CYL+CONE), v: 0.35 + Math.random()*0.35, w: Math.random()*6 }));

    // White yeast settled in the bottom of the cone (Chad, 2026-10-04): stays until
    // the batch's "Dump yeast" task is done.
    const yTop = TIP + CONE*0.34, yR = r => r*INSET*0.985;
    const ypts = [new THREE.Vector2(0.001, TIP), new THREE.Vector2(yR(0.11), TIP)];
    for (let i=1;i<=16;i++){ const yy = TIP + (yTop-TIP)*i/16; ypts.push(new THREE.Vector2(yR(radiusAt(yy)), yy)); }
    t.yeastMat = new THREE.MeshStandardMaterial({ color:0xf4efe2, roughness:0.85, metalness:0, emissive:0x2a2822, transparent:true, opacity:0.95 });
    t.yeastGroup = new THREE.Group(); t.yeastGroup.visible = false; group.add(t.yeastGroup);
    const ySide = new THREE.Mesh(new THREE.LatheGeometry(ypts, 64), t.yeastMat); ySide.renderOrder = 1.6; t.yeastGroup.add(ySide);
    const yCapGeo = new THREE.RingGeometry(0.0001, 1, 64, 6), yc = yCapGeo.attributes.position.array;
    for (let i=0;i<yc.length;i+=3){ const x=yc[i], y=yc[i+1], r=Math.hypot(x,y); yc[i+2] = (0.03*Math.sin(x*9+1.3) + 0.025*Math.sin(y*11+0.4) + 0.02) * Math.min(1,(1-r)*4); }
    yCapGeo.computeVertexNormals();
    const yCap = new THREE.Mesh(yCapGeo, t.yeastMat); yCap.rotation.x = -Math.PI/2; yCap.position.y = yTop;
    yCap.scale.set(yR(radiusAt(yTop)), yR(radiusAt(yTop)), 1); yCap.renderOrder = 1.6; t.yeastGroup.add(yCap);
    t.yeastTop = yTop; t.yeastOn = false; t.dryHop = false;

    t.buildLiquid = function(y){
      const pts = [new THREE.Vector2(0.001, TIP), new THREE.Vector2(0.11*INSET, TIP)];
      const steps = 40;
      for (let i=1;i<=steps;i++){ const yy = TIP + (y-TIP)*i/steps; pts.push(new THREE.Vector2(radiusAt(yy)*INSET, yy)); }
      t.liquid.geometry.dispose(); t.liquid.geometry = new THREE.LatheGeometry(pts, 72);
      const r = radiusAt(y)*INSET;
      t.surface.position.y = y; t.surface.scale.set(r, r, 1);
      const fh = 0.14; t.foamLevel = y + fh; t.liquidLevel = y;
      t.foam.position.y = y + fh/2; t.foam.scale.set(r*0.995, fh, r*0.995);
      t.foamTop.position.y = y + fh; t.foamTop.scale.set(r*0.995, r*0.995, 1);
    };

    // Glass shell (x-ray edge glow)
    t.shellMat = new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide,
      uniforms:{ uColor:{ value:new THREE.Color(0xcfe6d8) }, uGlow:{ value:new THREE.Color(0x8fd16e) }, uHover:{ value:0 } },
      vertexShader:shellVS, fragmentShader:shellFS });
    const shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), t.shellMat);
    shell.renderOrder = 3; shell.userData.tank = t; group.add(shell); pickables.push(shell);
    t.shell = shell;
    // Solid brushed-stainless version, shown instead of the x-ray glass when the tank is empty
    // Empty tank = polished stainless: mirror-bright cylinder + dome, softer satin cone (like the photo)
    t.solidMat = new THREE.MeshPhysicalMaterial({ color:0xe6ebe8, metalness:1.0, roughness:0.11, envMap:steelEnv, envMapIntensity:1.25, clearcoat:0.8, clearcoatRoughness:0.04, emissive:0x6abc46, emissiveIntensity:0, side:THREE.DoubleSide });
    t.coneMat = new THREE.MeshPhysicalMaterial({ color:0xc9cfcb, metalness:1.0, roughness:0.32, envMap:steelEnv, envMapIntensity:1.0, clearcoat:0.3, clearcoatRoughness:0.25, emissive:0x6abc46, emissiveIntensity:0, side:THREE.DoubleSide });
    t.solid = new THREE.Group(); group.add(t.solid);
    const sBody = new THREE.Mesh(new THREE.LatheGeometry(profile.slice(7), 128), t.solidMat);
    const sCone = new THREE.Mesh(new THREE.LatheGeometry(profile.slice(0, 8), 96), t.coneMat);
    for (const m of [sBody, sCone]){ m.userData.tank = t; t.solid.add(m); pickables.push(m); }
    // Glycol jacket seams on the solid tank: thin darker rings
    t.solidBands = new THREE.Group(); group.add(t.solidBands);
    const seamMat = new THREE.MeshStandardMaterial({ color:0xa7afaa, metalness:1.0, roughness:0.28, envMap:steelEnv, envMapIntensity:0.9 });
    [0.12,0.36,0.59,0.84].forEach(f=>{ const seam = new THREE.Mesh(new THREE.CylinderGeometry(R*1.006,R*1.006,0.03,72,1,true), seamMat); seam.position.y = Y_CONE + CYL*f; t.solidBands.add(seam); });

    // Wireframe
    t.lineMat = new THREE.LineBasicMaterial({ color:0x8fd16e, transparent:true, opacity:0.32, depthWrite:false });
    const seg = [], MER = 24;
    for (let m=0;m<MER;m++){ const a = m/MER*Math.PI*2, s=Math.sin(a), c=Math.cos(a);
      for (let i=1;i<profile.length;i++){ const p0=profile[i-1], p1=profile[i]; seg.push(p0.x*s, p0.y, p0.x*c, p1.x*s, p1.y, p1.x*c); } }
    [TIP, TIP+CONE*0.5, Y_CONE, Y_CONE+CYL*0.25, Y_CONE+CYL*0.5, Y_CONE+CYL*0.75, Y_CYL, Y_CYL+DOME*0.55].forEach(y=>{
      const r = y<=Y_CYL ? radiusAt(y) : R*Math.cos(Math.asin(Math.min(1,(y-Y_CYL)/DOME)));
      for (let i=0;i<72;i++){ const a0=i/72*Math.PI*2, a1=(i+1)/72*Math.PI*2; seg.push(r*Math.sin(a0), y, r*Math.cos(a0), r*Math.sin(a1), y, r*Math.cos(a1)); }
    });
    const wireGeo = new THREE.BufferGeometry(); wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(seg,3));
    const wire = new THREE.LineSegments(wireGeo, t.lineMat); wire.renderOrder = 4; group.add(wire); t.wire = wire;

    // Glycol jacket bands
    t.bands = [];
    [[0.12,0.36],[0.59,0.84]].forEach(([a,b])=>{
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R*1.012,R*1.012,CYL*(b-a),72,1,true), bandMat);
      band.position.y = Y_CONE + CYL*(a+b)/2; band.renderOrder=3; group.add(band); t.bands.push(band);
    });

    // Steel
    const legTop = Y_CONE + 0.25;
    for (let i=0;i<4;i++){
      const a = Math.PI/4 + i*Math.PI/2, x = Math.sin(a)*R*1.03, z = Math.cos(a)*R*1.03;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.045,legTop,16), steel);
      leg.position.set(x, legTop/2, z); leg.userData.tank = t; group.add(leg); pickables.push(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.12,0.04,20), steelDark); foot.position.set(x, 0.02, z); group.add(foot);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.32,0.05), steel);
      pad.position.set(x*0.985, legTop-0.12, z*0.985); pad.lookAt(0, legTop-0.12, 0); group.add(pad);
    }
    // FV number tag on a steel bracket, off the right side of the front-left leg, 1/4 of the way up, facing the front (Chad, 2026-10-05)
    {
      const a = Math.PI/4 + 3*Math.PI/2, lx = Math.sin(a)*R*1.03, lz = Math.cos(a)*R*1.03;
      t.tagCanvas = document.createElement('canvas'); t.tagCanvas.width = 256; t.tagCanvas.height = 120;
      t.tagTex = new THREE.CanvasTexture(t.tagCanvas); t.tagTex.encoding = THREE.sRGBEncoding; t.tagTex.anisotropy = 4;
      const tagMat = new THREE.MeshBasicMaterial({ map:t.tagTex, transparent:true });
      const tagW = 0.56, tagH = tagW*120/256;
      // Tag sits off the right side of the leg (as you face the tank), held by a steel bracket (Chad, 2026-10-05)
      const legR = 0.045, armL = 0.09, tx = lx + legR + armL + tagW/2, ty = legTop/4;   // a quarter of the way up the leg (Chad, 2026-10-05)
      for (const flip of [0, Math.PI]){
        const m = new THREE.Mesh(new THREE.PlaneGeometry(tagW, tagH), tagMat);
        m.rotation.y = flip; m.position.set(tx, ty, lz + (flip ? -0.002 : 0.002)); m.renderOrder = 5; m.userData.tank = t; group.add(m); pickables.push(m);
      }
      // bracket: clamp band around the leg + two short flat arms out to a backing plate behind the tag
      const strap = new THREE.Mesh(new THREE.CylinderGeometry(legR + 0.012, legR + 0.012, 0.16, 16), steelDark);
      strap.position.set(lx, ty, lz); group.add(strap);
      for (const dy of [-0.05, 0.05]){
        const arm = new THREE.Mesh(new THREE.BoxGeometry(armL + 0.04, 0.025, 0.02), steelDark);
        arm.position.set(lx + legR + armL/2 - 0.01, ty + dy, lz); group.add(arm);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(tagW + 0.02, tagH + 0.02, 0.012), steelDark);
      back.position.set(tx, ty, lz - 0.01); group.add(back);
    }
    const add = (geo, mat, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); if (rx) m.rotation.x = rx; if (rz) m.rotation.z = rz; group.add(m); return m; };
    add(new THREE.CylinderGeometry(0.06,0.06,0.42,16), steel, 0, TIP-0.22, 0);
    add(new THREE.CylinderGeometry(0.11,0.11,0.06,20), steelDark, 0, TIP-0.3, 0);
    add(new THREE.BoxGeometry(0.34,0.025,0.05), steel, 0.15, TIP-0.25, 0);
    const rackY = TIP + CONE*0.55, rackR = radiusAt(rackY);
    add(new THREE.CylinderGeometry(0.05,0.05,0.42,16), steel, rackR+0.17, rackY, 0, 0, Math.PI/2);
    add(new THREE.CylinderGeometry(0.09,0.09,0.05,20), steelDark, rackR+0.36, rackY, 0, 0, Math.PI/2);
    add(new THREE.CylinderGeometry(0.022,0.022,0.16,10), steel, -0.55, Y_CONE+0.6, Math.sqrt(R*R-0.55*0.55)+0.07, Math.PI/2);
    // Carb stone (shown only while Carbonating): through the carb port above into the beer —
    // round clamp flange outside, thin polished tube, longer matte gray porous stone, rounded end.
    {
      const portX = -0.55, portY = Y_CONE + 0.6, portZ = Math.sqrt(R*R - portX*portX);
      const dir = new THREE.Vector3(-portX, 0, -portZ).normalize();      // pointing into the tank
      t.carbStone = new THREE.Group(); t.carbStone.visible = false; group.add(t.carbStone);
      t.carbStone.position.set(portX, portY, portZ);
      t.carbStone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);  // local +y = into the tank
      // drawn on top of the beer (not hidden inside hazy beer) so the stone is clearly visible (Chad)
      const tubeMat = new THREE.MeshStandardMaterial({ color:0xd0d6d2, metalness:1.0, roughness:0.2, envMap:steelEnv, envMapIntensity:1.0, transparent:true });
      const stoneMat = new THREE.MeshStandardMaterial({ color:0xc9cdca, roughness:0.95, metalness:0, emissive:0x2a2c2b, transparent:true });
      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.016, 20), tubeMat); flange.position.y = -0.16; t.carbStone.add(flange);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.36, 12), tubeMat); tube.position.y = 0.02; t.carbStone.add(tube);
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.62, 16), stoneMat); stone.position.y = 0.5; t.carbStone.add(stone);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 10), stoneMat); cap.position.y = 0.81; t.carbStone.add(cap);
      t.carbStone.children.forEach(m => m.renderOrder = 1.7);
      t.carbStone.scale.setScalar(0.75);   // 25% smaller (Chad, 2026-10-05)
      t.stoneStart = new THREE.Vector3(portX, portY, portZ).addScaledVector(dir, 0.19*0.75);   // where the stone section begins
      t.stoneMid = new THREE.Vector3(portX, portY, portZ).addScaledVector(dir, 0.5*0.75);      // cone of bubbles starts here
      t.stoneDir = dir;
      // a crazy amount of tiny bubbles pouring off the stone and rising to the top
      const CARB_N = 4200;
      t.carbGeo = new THREE.BufferGeometry(); t.carbPos = new Float32Array(CARB_N*3);
      t.carbGeo.setAttribute('position', new THREE.BufferAttribute(t.carbPos, 3));
      t.carbBubbles = new THREE.Points(t.carbGeo, new THREE.PointsMaterial({ color:0xfffdf4, size:0.022*Rft, sizeAttenuation:true, transparent:true, opacity:0.8, depthWrite:false }));
      t.carbBubbles.renderOrder = 1.5; t.carbBubbles.frustumCulled = false; t.carbBubbles.visible = false; group.add(t.carbBubbles);
      t.carbState = Array.from({length:CARB_N}, ()=>({ y: -1, th: Math.random()*Math.PI*2, u: Math.sqrt(Math.random()), v: 0.5 + Math.random()*0.6, w: Math.random()*6 }));
    }
    add(new THREE.CylinderGeometry(0.24,0.24,0.14,32), steel, 0, Y_TOP+0.04, 0);
    add(new THREE.CylinderGeometry(0.27,0.27,0.04,32), steelDark, 0, Y_TOP+0.13, 0);
    add(new THREE.CylinderGeometry(0.045,0.045,0.42,12), steel, 0.55, Y_CYL+0.33, 0.1);
    add(new THREE.CylinderGeometry(0.045,0.045,0.3,12), steel, 0.7, Y_CYL+0.54, 0.1, 0, Math.PI/2);
    add(new THREE.CylinderGeometry(0.03,0.03,0.18,10), steelDark, -R-0.07, Y_CONE+CYL*0.45, 0, 0, Math.PI/2);

    // Label plate
    t.plateCanvas = document.createElement('canvas'); t.plateCanvas.width = 640; t.plateCanvas.height = 270;
    t.plateTex = new THREE.CanvasTexture(t.plateCanvas); t.plateTex.encoding = THREE.sRGBEncoding; t.plateTex.anisotropy = 4;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(R*1.03,R*1.03,0.446,48,1,true,-0.375,0.75), new THREE.MeshBasicMaterial({ map:t.plateTex, transparent:true }));
    // Label plate: its bottom edge sits where the cone ends (Chad, 2026-10-04)
    plate.position.y = Y_CONE + 0.223 + 0.04;   /* 25% smaller, FV number moved to the leg tag (Chad, 2026-10-05) */ plate.renderOrder = 5; plate.userData.tank = t; group.add(plate); pickables.push(plate);
    // Temperature strip stuck on the tank's right side (as you face the front) — like the
    // stick-on LCD strips in the brewery, 30–100 °F (Chad, 2026-10-05). Sample temps for now.
    t.tempCanvas = document.createElement('canvas'); t.tempCanvas.width = 160; t.tempCanvas.height = 900;
    t.tempTex = new THREE.CanvasTexture(t.tempCanvas); t.tempTex.encoding = THREE.sRGBEncoding; t.tempTex.anisotropy = 4;
    const stripH = CYL*0.78;
    const strip = new THREE.Mesh(new THREE.CylinderGeometry(R*1.012, R*1.012, stripH, 24, 1, true, 0.66, 0.32),   // front-right, just past the label
      new THREE.MeshBasicMaterial({ map:t.tempTex, transparent:true }));
    strip.position.y = Y_CONE + CYL*0.5; strip.renderOrder = 5; strip.userData.tank = t; group.add(strip); pickables.push(strip);
    t.tempF = spec.vol ? 67 : 58;          // sample: fermenting ~67 °F, empty tanks at cellar temp
    // Current-temp pill: the same pill that was drawn on the scale, same size, now standing
    // out from the tank at 45° (was 90°), its inner edge on the scale (Chad, 2026-10-05).
    t.tempTop = Y_CONE + CYL*0.5 + stripH/2; t.tempStripH = stripH;
    t.winCanvas = document.createElement('canvas'); t.winCanvas.width = 204; t.winCanvas.height = 120;
    t.winTex = new THREE.CanvasTexture(t.winCanvas); t.winTex.encoding = THREE.sRGBEncoding; t.winTex.anisotropy = 4;
    const winR = R*1.012, winTh = 0.66 + 0.32*(50/160);       // where the pill's left edge was on the scale
    const pillW = 0.32*winR*(102/160)*1.2, pillH = stripH*(60/900)*1.2;  // old flat pill size +20% (Chad, 2026-10-05)
    const win = new THREE.Group(); win.rotation.y = winTh - Math.PI/2 + Math.PI/4;   // 45° off the tank, face toward the front (Chad)
    win.position.set(winR*Math.sin(winTh), 0, winR*Math.cos(winTh));
    const pillMat = new THREE.MeshBasicMaterial({ map: t.winTex, transparent: true });
    for (const flip of [0, Math.PI]){                           // readable from both sides
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pillW, pillH), pillMat);
      m.rotation.y = flip; m.renderOrder = 6; m.userData.tank = t; pickables.push(m);
      const holder = new THREE.Group(); holder.position.x = pillW/2; holder.add(m); win.add(holder);
    }
    group.add(win);
    t.tempWin = win; t.winY = null;

    t.shownFrac = t.volume / t.capacity; t.targetFrac = t.shownFrac; t.lastFerFrac = -1;
    t.buildLiquid(heightFor(t.shownFrac));
    return t;
  }

  // 32 °F icy blue → FCB green → yellow → orange → 100 °F red
  const TEMP_STOPS = [[30,'#d6f6ff'],[32,'#bfefff'],[40,'#5ab8ff'],[55,'#6abc46'],[70,'#f2c84b'],[85,'#ff8a3d'],[100,'#ff4d4d']];
  function tempColor(f){
    const v = Math.max(30, Math.min(100, f));
    for (let i=1;i<TEMP_STOPS.length;i++){
      const [f1,c1] = TEMP_STOPS[i]; const [f0,c0] = TEMP_STOPS[i-1];
      if (v <= f1){ const k = (v-f0)/(f1-f0); return '#' + new THREE.Color(c0).lerp(new THREE.Color(c1), k).getHexString(); }
    }
    return '#ff4d4d';
  }
  function drawTemp(t){
    const g = t.tempCanvas.getContext('2d'), W = 160, H = 900, hasTemp = typeof t.tempF === 'number', cur = hasTemp ? t.tempF : -100, curCol = tempColor(cur);
    g.clearRect(0,0,W,H);
    // no background (Chad, 2026-10-05): just the scale, straight on the tank
    g.fillStyle = '#A3ADA8'; g.font = `600 30px ${FONT}`; g.textAlign = 'center'; g.fillText('°F', W/2, 50);
    const y0 = 820, y1 = 90, yOf = f => y0 - (f-30)/(100-30)*(y0-y1);
    // the full blue→red scale, faint
    const grad = g.createLinearGradient(0, y0, 0, y1);
    for (const [f,c] of TEMP_STOPS) grad.addColorStop((f-30)/70, c);
    g.globalAlpha = 0.25; g.fillStyle = grad; roundRect(g, 24, y1, 22, y0-y1, 11); g.fill(); g.globalAlpha = 1;
    // filled up to the current temperature, in its color (no reading from Ekos → empty scale, no pill)
    if (hasTemp){ g.fillStyle = curCol; roundRect(g, 24, yOf(cur), 22, y0 - yOf(cur), 11); g.fill(); }
    g.fillStyle = hasTemp ? curCol : 'rgba(255,255,255,0.18)';
    g.beginPath(); g.arc(35, y0 + 22, 20, 0, Math.PI*2); g.fill();                 // thermometer bulb
    // readings every 10 °F, colored along the scale
    g.textAlign = 'left'; g.font = `600 34px ${MONO}`;
    for (let f=30; f<=100; f+=10){
      const y = yOf(f);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(52, y-1, 14, 3);
      g.fillStyle = tempColor(f); g.globalAlpha = Math.abs(f - cur) < 5 ? 0.25 : 0.85; g.fillText(String(f), 74, y + 12); g.globalAlpha = 1;
    }
    if (t.tempWin) t.tempWin.visible = hasTemp;
    if (hasTemp) drawTempWindow(t, cur, curCol);
    t.tempTex.needsUpdate = true;
  }
  function drawTempWindow(t, cur, curCol){
    if (!t.winCanvas) return;
    const g = t.winCanvas.getContext('2d'), W = 204, H = 120;
    g.clearRect(0,0,W,H);
    g.fillStyle = curCol; roundRect(g, 0, 0, W, H, 60); g.fill();
    g.fillStyle = '#0B1208'; g.font = `800 76px ${FONT}`; g.textAlign = 'center';
    g.fillText(Math.round(cur) + '°', W/2, H/2 + 27);
    t.winTex.needsUpdate = true;
    // where the window sits on the scale (same 30–100 °F mapping as the strip canvas)
    const py = 820 - (Math.max(30, Math.min(100, cur)) - 30)/70*730;
    t.winTarget = t.tempTop - (py/900)*t.tempStripH;
    if (t.winY === null){ t.winY = t.winTarget; t.tempWin.position.y = t.winY; }
  }
  const PLATE_STATUS = { 'Fermenting':'#D98200', 'Dry Hopping':'#7FA61C', 'Cold Crashing':'#2F86E0',
    'Carbonating':'#7D55D9', 'Ready For Packaging':'#3F8F22', 'Conditioning':'#2F86E0', 'Empty':'#8a948f' };
  function drawPlate(t){
    const g = t.plateCanvas.getContext('2d'), W=640, H=270, full = t.volume > 0.05;
    g.clearRect(0,0,W,H);
    g.fillStyle = 'rgba(236,242,238,0.94)'; roundRect(g, 6, 6, W-12, H-12, 30); g.fill();
    g.fillStyle = '#0D1210'; g.font = `700 92px ${FONT}`; g.textBaseline = 'alphabetic';
    // FV number now lives on the leg tag (Chad, 2026-10-05)
    // tank status under the FV number (Chad, 2026-10-05)
    const st = full ? (t.stageName || t.status) : 'Empty';
    const stLabel = st === 'Ready' ? 'Ready For Packaging' : st;
    g.font = `700 34px ${FONT}`;
    const stW = g.measureText(stLabel).width + 44;
    g.fillStyle = PLATE_STATUS[stLabel] || '#8a948f'; roundRect(g, 40, 30, stW, 52, 26); g.fill();
    g.fillStyle = '#FFFFFF'; g.fillText(stLabel, 62, 68);
    if (full){ g.fillStyle = t.color; roundRect(g, 42, 118, 30, 30, 8); g.fill(); }
    if (full){   // full product name, never cut off: shrink the text to fit (Chad, 2026-10-04)
      g.fillStyle = '#1d2621';
      let size = 40; g.font = `600 ${size}px ${FONT}`;
      while (g.measureText(t.spec.product).width > W - 128 && size > 20){ size -= 1; g.font = `600 ${size}px ${FONT}`; }
      g.fillText(t.spec.product, 88, 146);
    }   // empty tanks: the status pill already says Empty
    g.fillStyle = '#4a5650'; g.font = `500 38px ${MONO}`;
    g.fillText(t.volume.toFixed(1) + ' / ' + t.capacity + ' bbl', 40, 226);
    g.textAlign = 'right'; g.fillStyle = '#2f6f19'; g.font = `700 46px ${MONO}`;
    g.fillText(Math.round(t.volume / t.capacity * 100) + '%', W-40, 228); g.textAlign = 'left';
    t.plateTex.needsUpdate = true;
    if (t.tagCanvas){   // FV number on the leg tag
      const k = t.tagCanvas.getContext('2d');
      k.clearRect(0,0,256,120);
      k.fillStyle = 'rgba(236,242,238,0.96)'; roundRect(k, 4, 4, 248, 112, 22); k.fill();
      k.fillStyle = '#0D1210'; k.textAlign = 'center'; k.textBaseline = 'alphabetic';
      let size = 76; k.font = `800 ${size}px ${FONT}`;
      while (k.measureText(t.name).width > 220 && size > 30){ size -= 2; k.font = `800 ${size}px ${FONT}`; }
      k.fillText(t.name, 128, 60 + size*0.36); k.textAlign = 'left';
      t.tagTex.needsUpdate = true;
    }
  }
  function applyLook(t){
    const look = LOOKS[lookFor(t.spec.product)], full = t.volume > 0.05;
    const col = new THREE.Color(look.color).convertSRGBToLinear();
    t.liquidMat.color.copy(col); t.liquidMat.emissive.copy(col).multiplyScalar(look.glow); t.liquidMat.opacity = look.opacity;
    t.surfMat.color.copy(col).offsetHSL(0,-0.08,-0.02); t.surfMat.emissive.copy(col).multiplyScalar(look.glow * 0.6); t.surfMat.opacity = Math.min(0.9, look.opacity + 0.15);
    const ferm = full && t.status === 'Fermenting';
    t.foam.visible = t.foamTop.visible = t.pops.visible = t.rising.visible = ferm;
    t.surface.visible = full; t.liquid.visible = t.shownFrac > 0.002 || full;
    if (!full) t.status = 'Empty'; else if (t.status === 'Empty') t.status = 'Fermenting';
    // Empty = solid stainless; full = x-ray glass + wireframe
    t.solid.visible = t.solidBands.visible = !full;
    t.shell.visible = t.wire.visible = full; t.bands.forEach(b => b.visible = full);
    // Dry hop (dry hop task done, until the tank is set to Cold Crash): dark-green foam,
    // light-green hops sinking, no rising CO2 bubbles, dark-green hop cone in the bottom.
    const dh = full && ferm && t.dryHop;
    const lin = h => new THREE.Color(h).convertSRGBToLinear();   // true-to-screen colors
    t.foamMat.color.copy(dh ? lin(0x2f4a1a) : new THREE.Color(0xf3ead2)); t.foamMat.opacity = dh ? 0.75 : 0.55;
    t.popMat.color.copy(dh ? lin(0x4c6e28) : new THREE.Color(0xfffbef)); t.popMat.emissive.copy(dh ? lin(0x142208) : new THREE.Color(0x3a3528));
    t.rising.visible = ferm && !dh;
    t.sinking.visible = dh;
    t.floatHops.visible = dh; t.chunks.visible = dh;
    t.foam.visible = t.foamTop.visible = t.pops.visible = ferm && !dh;   // dry hop: no foam — floating hop cones instead (Chad)
    t.yeastMat.color.copy(dh ? lin(0xb1cd55) : new THREE.Color(0xf4efe2)); t.yeastMat.emissive.copy(dh ? lin(0x1c2a0a) : new THREE.Color(0x2a2822));
    t.yeastGroup.visible = full && (t.yeastOn || dh);
    if (t.crashIcon) t.crashIcon.visible = full && !!t.crash;   // cold crash: still beer + snowflake beside the tank
    t.carbStone.visible = t.carbBubbles.visible = full && !!t.carb;   // carbonating: stone + tiny bubbles, no foam
    if (full && t.carb) t.pops.visible = true;                          // ...and little bubbles popping on the beer's surface
  }

  // Foam motion (same as the approved example)
  function foamH(x, y, tm){
    const r = Math.hypot(x,y), a = Math.atan2(y,x);
    const edge = Math.min(1, Math.max(0, (1-r)*5));
    const h = 0.045*Math.sin(a*5 + tm*1.4 + r*7) + 0.032*Math.sin(r*13 - tm*2.1 + a*2) + 0.022*Math.sin(x*17 + y*11 + tm*3.2);
    return (0.05 + h) * edge;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
  function animateFerment(t, dt, tm){
    const pos = t.foamTopGeo.attributes.position.array, base = t.foamBase;
    for (let i=0;i<pos.length;i+=3) pos[i+2] = foamH(base[i], base[i+1], tm + t.spec.px*0.01);
    t.foamTopGeo.attributes.position.needsUpdate = true; t.foamTopGeo.computeVertexNormals();
    const fr = t.radiusAt(t.liquidLevel)*INSET*0.995;
    for (let i=0;i<POP_N;i++){
      const p = t.popState[i]; p.life += dt;
      if (p.life >= p.dur){ p.a = Math.random()*Math.PI*2; p.r = Math.sqrt(Math.random())*0.85; p.life = 0; p.dur = 0.5 + Math.random()*1.0; p.size = 0.014 + Math.random()*0.03; }
      const k = p.life / p.dur;
      const sc = k < 0.8 ? p.size * (0.2 + k) : p.size * (1.0 + (k-0.8)*2.5) * Math.max(0, 1 - (k-0.8)/0.2);
      const lx = Math.cos(p.a)*p.r, ly = Math.sin(p.a)*p.r;
      const top = t.foamLevel + foamH(lx, -ly, tm + t.spec.px*0.01);
      _v.set(lx*fr, top + sc*(k < 0.8 ? 0.15 + k*0.5 : 0.55), ly*fr); _s.set(sc, sc*0.9, sc);
      _m.compose(_v, _q, _s); t.pops.setMatrixAt(i, _m);
    }
    t.pops.instanceMatrix.needsUpdate = true;
    for (let i=0;i<RISE_N;i++){
      const b = t.riseState[i], st = t.streams[b.s];
      b.y += b.v*dt;
      if (b.y > t.liquidLevel - 0.02){ b.y = (t.yeastGroup.visible ? t.yeastTop + 0.05 : t.TIP + 0.15) + Math.random()*0.6; b.v = 0.35 + Math.random()*0.35; }
      const rr = Math.min(st.r, t.radiusAt(b.y)*0.85), wob = 0.03*Math.sin(tm*3 + b.w + b.y*4);
      t.risePos[i*3] = Math.cos(st.a)*rr + wob; t.risePos[i*3+1] = b.y; t.risePos[i*3+2] = Math.sin(st.a)*rr + 0.03*Math.cos(tm*2.5 + b.w);
    }
    t.riseGeo.attributes.position.needsUpdate = true;
    if (t.sinking.visible){
      const floor = t.yeastTop + 0.03;
      for (let i=0;i<RISE_N;i++){
        const h = t.hopState[i];
        if (h.y < 0) h.y = floor + Math.random()*(t.liquidLevel - floor);       // first frame: spread through the beer
        h.y -= h.v*dt;
        if (h.y < floor){ h.y = t.liquidLevel - 0.03 - Math.random()*0.25; h.a = Math.random()*Math.PI*2; h.r = Math.sqrt(Math.random())*0.85; h.v = 0.18 + Math.random()*0.22; }
        const rr = h.r * t.radiusAt(h.y) * INSET * 0.95;
        t.hopPos[i*3]   = Math.cos(h.a)*rr + 0.04*Math.sin(tm*1.6 + h.w + h.y*3);
        t.hopPos[i*3+1] = h.y;
        t.hopPos[i*3+2] = Math.sin(h.a)*rr + 0.04*Math.cos(tm*1.3 + h.w);
      }
      t.hopGeo.attributes.position.needsUpdate = true;
    }
    if (t.chunks.visible){
      const floor = t.yeastTop + 0.03, top = t.liquidLevel - 0.08;
      for (let i=0;i<t.chunkState.length;i++){
        const h = t.chunkState[i];
        if (h.y < 0) h.y = floor + Math.random()*(top - floor);
        h.y -= h.v*dt; h.rx += h.sx*dt; h.ry += h.sy*dt;
        if (h.y < floor){ h.y = top - Math.random()*0.15; h.a = Math.random()*Math.PI*2; h.r = Math.sqrt(Math.random())*0.82; }
        const rr = h.r * t.radiusAt(h.y) * INSET * 0.93;
        _v.set(Math.cos(h.a)*rr + 0.04*Math.sin(tm*1.4 + h.w + h.y*3), h.y, Math.sin(h.a)*rr + 0.04*Math.cos(tm*1.1 + h.w));
        _e.set(h.rx, h.ry, 0, 'XYZ'); _q2.setFromEuler(_e); _s.set(h.size, h.size*0.8, h.size);
        _m.compose(_v, _q2, _s); t.chunks.setMatrixAt(i, _m);
      }
      t.chunks.instanceMatrix.needsUpdate = true;
    }
    if (t.floatHops.visible){
      const rr = t.radiusAt(t.liquidLevel) * INSET * 0.99;
      for (let i=0;i<t.floatState.length;i++){
        const h = t.floatState[i];
        const rc = Math.min(h.r*rr, rr - h.size*0.42);                   // touch the wall without poking through the glass
        const bob = 0.035*Math.sin(tm*h.f + h.ph);                       // each cone bobs on its own
        _v.set(Math.cos(h.a)*rc + 0.012*Math.sin(tm*0.4 + h.ph), t.liquidLevel + 0.03 + h.lift + bob, Math.sin(h.a)*rc + 0.012*Math.cos(tm*0.35 + h.ph));
        _e.set(h.tilt + 0.12*Math.sin(tm*h.f*0.8 + h.ph), h.yaw + 0.1*Math.sin(tm*0.3 + h.ph), 0.1*Math.cos(tm*h.f + h.ph), 'YXZ');
        _q2.setFromEuler(_e); _s.set(h.size, h.size, h.size);
        _m.compose(_v, _q2, _s); t.floatHops.setMatrixAt(i, _m);
      }
      t.floatHops.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Cold-crash indicator: 3D snowflake + moving down arrow, floating in front
  // of the tank, fixed in place and facing forward (Chad, 2026-10-05) ----------
  const iceMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0xdff1ff).convertSRGBToLinear(), emissive:new THREE.Color(0x4aa8ff).convertSRGBToLinear(), emissiveIntensity:0.55, roughness:0.25, metalness:0.2 });
  const arrowMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x8ec3ff).convertSRGBToLinear(), emissive:new THREE.Color(0x2f7fe0).convertSRGBToLinear(), emissiveIntensity:0.6, roughness:0.3, metalness:0.1, transparent:true });
  function makeCrashIcon(){
    const g = new THREE.Group(), flake = new THREE.Group();
    const armGeo = new THREE.BoxGeometry(0.1, 1.0, 0.1), twigGeo = new THREE.BoxGeometry(0.075, 0.34, 0.075);
    for (let k=0;k<6;k++){
      const arm = new THREE.Group(); arm.rotation.z = k*Math.PI/3;
      const a = new THREE.Mesh(armGeo, iceMat); a.position.y = 0.5; arm.add(a);
      for (const [y, len] of [[0.52, 1], [0.78, 0.7]]){
        for (const sgn of [-1, 1]){
          const tw = new THREE.Mesh(twigGeo, iceMat); tw.scale.y = len;
          tw.position.set(sgn*0.11*len, y + 0.1*len, 0); tw.rotation.z = -sgn*0.8; arm.add(tw);
        }
      }
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), iceMat); tip.position.y = 1.0; arm.add(tip);
      flake.add(arm);
    }
    flake.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 6).rotateX(Math.PI/2), iceMat));
    flake.scale.setScalar(0.9);
    g.add(flake); g.userData.flake = flake;
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 12), arrowMat); shaft.position.y = 0.2; arrow.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 16), arrowMat); head.rotation.x = Math.PI; head.position.y = -0.4; arrow.add(head);
    arrow.position.set(0, -1.6, 0); g.add(arrow); g.userData.arrow = arrow;
    g.visible = false; scene.add(g);
    return g;
  }
  function updateCrashIcon(t, tm){
    const g = t.crashIcon; if (!g.visible) return;
    // Fixed spot in front of the tank (the label side), always facing forward — it does
    // not follow the camera (Chad, 2026-10-05). Only the arrow moves.
    g.position.set(t.group.position.x, t.Hft*0.84, t.group.position.z + t.Rft + 1.2);   // above the label so it never covers it
    g.rotation.set(0, 0, 0);
    const k = (tm*0.6) % 1;                                                  // arrow keeps sliding down, fades, repeats
    g.userData.arrow.position.y = -1.3 - k*1.1;
    arrowMat.opacity = Math.min(1, Math.min(k*5, (1-k)*4));
  }

  // Carbonation bubbles rise in an upside-down cone: tight at the stone, spreading out to the
  // full width of the tank at the top of the beer (Chad, 2026-10-05).
  function animateCarb(t, dt, tm){
    const m = t.stoneMid, y0 = m.y, top = t.liquidLevel - 0.01, span = Math.max(0.2, top - y0);
    for (let i=0;i<t.carbState.length;i++){
      const b = t.carbState[i];
      if (b.y < 0 || b.y > top){
        b.th = Math.random()*Math.PI*2; b.u = Math.sqrt(Math.random());
        b.y = b.y < 0 ? y0 + Math.random()*span : y0 + Math.random()*0.03;
      }
      b.y += b.v*dt;
      const f = Math.min(1, Math.max(0, (b.y - y0)/span));          // 0 at the stone → 1 at the surface
      const wall = t.radiusAt(b.y)*INSET*0.96;
      // cone axis drifts from the stone toward the tank's center as it rises, reaching full width at the top
      const cx = m.x*(1-f), cz = m.z*(1-f), rad = (0.03 + f*wall)*b.u;
      let x = cx + Math.cos(b.th)*rad + Math.sin(tm*2 + b.w)*0.006, z = cz + Math.sin(b.th)*rad;
      const r = Math.hypot(x, z); if (r > wall){ x *= wall/r; z *= wall/r; }
      t.carbPos[i*3] = x; t.carbPos[i*3+1] = b.y; t.carbPos[i*3+2] = z;
    }
    t.carbGeo.attributes.position.needsUpdate = true;
    // bubbles popping on the surface (no foam): small, quick, all across the top
    const fr = t.radiusAt(t.liquidLevel)*INSET*0.97;
    for (let i=0;i<POP_N;i++){
      const p = t.popState[i]; p.life += dt;
      if (p.life >= p.dur){ p.a = Math.random()*Math.PI*2; p.r = Math.sqrt(Math.random()); p.life = 0; p.dur = 0.3 + Math.random()*0.5; p.size = 0.02 + Math.random()*0.035; }
      const k = p.life / p.dur;
      const sc = k < 0.75 ? p.size*(0.3 + k) : p.size*(1.05 + (k-0.75)*2)*Math.max(0, 1 - (k-0.75)/0.25);
      _v.set(Math.cos(p.a)*p.r*fr, t.liquidLevel + sc*0.3, Math.sin(p.a)*p.r*fr); _s.set(sc, sc*0.8, sc);
      _m.compose(_v, _q, _s); t.pops.setMatrixAt(i, _m);
    }
    t.pops.instanceMatrix.needsUpdate = true;
  }

  // Live tank map from Ekos (when the tank sync has run) — keeps the layout and
  // sizes above, takes everything else from Ekos.
  const LIVE = new Map((Array.isArray(live) ? live : []).map(r => [String(r.tank_name).toUpperCase(), r]));
  const SPECS = LIVE.size === 0 ? TANKS : TANKS.map(s => {
    const r = LIVE.get(s.name.toUpperCase());
    const vol = r && Number(r.volume_bbl) > 0.05 ? Number(r.volume_bbl) : 0;
    return { name: s.name, bbl: s.bbl, px: s.px, py: s.py,
      vol: vol || undefined,
      code: vol ? (r.product_code || undefined) : undefined,
      product: vol ? (r.product_name || r.product_code || 'Unknown product') : undefined,
      batch: vol ? (r.batch_title || undefined) : undefined,
      color: vol ? (r.color || '#9AA39E') : undefined };
  });
  const tanks = SPECS.map(makeTank);
  tanks.forEach(t => { t.crashIcon = makeCrashIcon(); t.crash = false; });
  // ---------- Overdue task warning (Chad, 2026-10-05): a 3D yellow warning sign with "!"
  // floating above the tank when any task for its batch is past its date and not Completed
  // (what Ekos's red dashed border means). Fixed in place, facing front. Sample tanks for now:
  // the ones Ekos showed dashed on Oct 5 — with live data, Ekos's red dashed border.
  const warnMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0xffc21a).convertSRGBToLinear(), emissive:new THREE.Color(0xff9d00).convertSRGBToLinear(), emissiveIntensity:0.45, roughness:0.35, metalness:0.1 });
  const warnEdge = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x1a1a1a).convertSRGBToLinear(), roughness:0.5 });
  function triShape(r, rr){            // rounded triangle, point up
    const pts = [0, 1, 2].map(k => { const a = Math.PI/2 + k*Math.PI*2/3; return new THREE.Vector2(Math.cos(a)*r, Math.sin(a)*r); });
    const sh = new THREE.Shape();
    for (let k=0;k<3;k++){
      const p = pts[k], prev = pts[(k+2)%3], next = pts[(k+1)%3];
      const a = p.clone().lerp(prev, rr), b = p.clone().lerp(next, rr);
      if (k === 0) sh.moveTo(a.x, a.y); else sh.lineTo(a.x, a.y);
      sh.quadraticCurveTo(p.x, p.y, b.x, b.y);
    }
    sh.closePath(); return sh;
  }
  function makeWarnIcon(){
    const g = new THREE.Group(), sign = new THREE.Group(); g.add(sign);
    const back = new THREE.Mesh(new THREE.ExtrudeGeometry(triShape(1.25, 0.16), { depth:0.18, bevelEnabled:true, bevelThickness:0.05, bevelSize:0.05, bevelSegments:3 }), warnEdge);
    back.position.z = -0.12; sign.add(back);                                              // dark rim
    const face = new THREE.Mesh(new THREE.ExtrudeGeometry(triShape(1.02, 0.16), { depth:0.2, bevelEnabled:true, bevelThickness:0.04, bevelSize:0.04, bevelSegments:3 }), warnMat);
    face.position.z = -0.06; sign.add(face);                                              // yellow face
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.08), warnEdge); bar.position.set(0, 0.06, 0.2); sign.add(bar);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 20).rotateX(Math.PI/2), warnEdge); dot.position.set(0, -0.4, 0.2); sign.add(dot);
    sign.scale.setScalar(0.8);   // half of the first try (Chad: "too big, make them half the size")
    g.userData.sign = sign; g.visible = false; scene.add(g);
    return g;
  }
  const OVERDUE_SAMPLE = ['FV01', 'FV03', 'FV04', 'FV07', 'CID-1'];
  tanks.forEach(t => { t.warnIcon = makeWarnIcon(); t.overdue = LIVE.size ? !!(LIVE.get(t.name.toUpperCase()) || {}).overdue : OVERDUE_SAMPLE.includes(t.name); });
  function updateWarnIcon(t, tm){
    const g = t.warnIcon; g.visible = !!t.overdue; if (!g.visible) return;
    const ph = t.spec.px*0.013;
    g.position.set(t.group.position.x, t.Hft + 2.0 + (reduce ? 0 : 0.18*Math.sin(tm*1.6 + ph)), t.group.position.z);   // floats just above the lid
    g.rotation.set(0, 0, 0);                                                                                      // always faces front
    warnMat.emissiveIntensity = reduce ? 0.45 : 0.35 + 0.25*(0.5 + 0.5*Math.sin(tm*3.2));                          // gentle glow pulse
  }


  // Live stage / temps / tasks from the Ekos tank sync.
  const STAGES = ['Fermenting', 'Dry Hopping', 'Cold Crashing', 'Carbonating', 'Ready For Packaging'];
  if (LIVE.size) tanks.forEach(t => {
    const r = LIVE.get(t.name.toUpperCase()); if (!r) { t.tempF = null; return; }
    t.live = r;
    t.tempF = typeof r.temp_f === 'number' ? r.temp_f : null;
    if (t.volume <= 0.05) return;
    const stage = STAGES.includes(r.stage) ? r.stage : 'Fermenting';
    t.stageName = stage;
    t.crash = stage === 'Cold Crashing';
    t.carb = stage === 'Carbonating';
    t.status = stage === 'Ready For Packaging' ? 'Ready' : t.crash ? 'Cold Crashing' : t.carb ? 'Carbonating' : 'Fermenting';
    t.yeastOn = !!r.yeast_in_cone;
    t.dryHop = !!r.dry_hop && stage === 'Dry Hopping';
  });
  tanks.forEach(t => { applyLook(t); drawPlate(t); drawTemp(t); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ if (!disposed) tanks.forEach(t => { drawPlate(t); drawTemp(t); }); });

  // ---------- Keg pallets (Chad, 2026-10-06 — claude/tanks-keg-pallets-plan.md) ----------
  // On the open floor to the right of the tanks: 1/2 bbl kegs (8 per pallet) and 1/6 bbl
  // kegs (20 per pallet) on standard 48" x 40" wooden pallets, stacked 3 pallets high (a 4th
  // pallet starts a new stack next to it). Counts = Inventory & Allocation → Packaging
  // Inventory "On Hand" for the current week, read when the page opens. The top pallet
  // holds only the kegs left over; an empty pallet stays when the count is 0. Hovering a
  // pallet shows how many are on hand.
  const KEG_KINDS = [
    { key:'half',  label:'1/2 bbl Kegs', per:8,  dia:16.1/12, h:23.3/12 },
    { key:'sixth', label:'1/6 bbl Kegs', per:20, dia:9.25/12, h:23.3/12 },
  ];
  const PAL_X = 40/12, PAL_Z = 48/12, PAL_H = 5.5/12, PAL_PER_STACK = 3;
  const pallets = [];                       // one entry per pallet (hover info)
  function woodTex(){
    const W = 256, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#b89c74'; g.fillRect(0, 0, W, H);   // weathered pine
    let seed = 5; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i=0;i<46;i++){                       // grain lines along the board
      const y = rnd()*H, a = 0.05 + rnd()*0.12;
      g.strokeStyle = rnd() > 0.5 ? 'rgba(120,80,40,' + a + ')' : 'rgba(255,235,200,' + a*0.8 + ')';
      g.lineWidth = 0.6 + rnd()*1.6; g.beginPath(); g.moveTo(0, y);
      for (let x=0;x<=W;x+=16) g.lineTo(x, y + Math.sin(x*0.03 + i)*1.5);
      g.stroke();
    }
    for (let i=0;i<3;i++){                         // a couple of knots
      const x = rnd()*W, y = rnd()*H;
      g.fillStyle = 'rgba(110,70,35,0.45)'; g.beginPath(); g.ellipse(x, y, 5 + rnd()*4, 2 + rnd()*2, 0, 0, Math.PI*2); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const palletTex = woodTex();
  const woodMats = ['#ffffff', '#e8dcc8', '#d6c4a6'].map(tint =>
    new THREE.MeshStandardMaterial({ map:palletTex, color:new THREE.Color(tint).convertSRGBToLinear(), roughness:0.88, metalness:0 }));
  // One pallet = 3 stringers along the 48" side, 7 top deck boards and 5 bottom boards across them.
  const boardGeo = new THREE.BoxGeometry(1, 1, 1);
  function makePallet(PAL_X = 40/12, PAL_Z = 48/12){   // wooden pallet (48" x 40" default; lid pallet passes its own size)
    const p = new THREE.Group(), T = 0.75/12, STR_H = 3.5/12;
    const add = (w, h, d, x, y, z, k) => { const m = new THREE.Mesh(boardGeo, woodMats[k % woodMats.length]); m.scale.set(w, h, d); m.position.set(x, y, z); p.add(m); };
    for (let i=0;i<5;i++) add(PAL_X, T, 3.5/12, 0, T/2, -PAL_Z/2 + 1.75/12 + i*(PAL_Z - 3.5/12)/4, i);              // bottom boards
    for (let i=0;i<3;i++) add(1.5/12, STR_H, PAL_Z, -PAL_X/2 + 0.75/12 + i*(PAL_X - 1.5/12)/2, T + STR_H/2, 0, i+1);  // stringers
    for (let i=0;i<7;i++) add(PAL_X, T, 3.5/12, 0, T + STR_H + T/2, -PAL_Z/2 + 1.75/12 + i*(PAL_Z - 3.5/12)/6, i+2);  // top deck
    return p;
  }
  // Keg = one shape built per size, modeled on Chad's photos of FCB's real kegs (2026-10-06):
  // dull satin stainless with scuffs and grime (not mirror-polished), a bottom skirt, raised
  // rolling rings, a top chime with two oval handle cut-outs, a domed head and the Sankey valve
  // neck. Both sizes: two plain blue stripes round the body (Chad: "just put the blue stripes on
  // them then" / "both the sixtels and the halfs"). No rental-company logo or name.
  function mergeGeos(list){
    const pos = [], nor = [], uv = [], col = [];
    for (const [g0, c] of list.map(x => Array.isArray(x) ? x : [x, null])){
      const g = g0.index ? g0.toNonIndexed() : g0;
      const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i=0;i<P.length;i++){ pos.push(P[i]); nor.push(N[i]); }
      for (let i=0;i<P.length/3;i++){ uv.push(U ? U[i*2] : 0, U ? U[i*2+1] : 0); if (c) col.push(c.r, c.g, c.b); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  }
  // brushed satin steel with scuffs, water spots and a bit of grime (drawn here, no image file)
  function kegSteelTex(){
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#d4d6d3'; g.fillRect(0, 0, W, H);
    let seed = 21; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i=0;i<700;i++){                     // fine brushed lines around the keg
      const y = rnd()*H; g.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,62,60,0.07)';
      g.lineWidth = 0.5 + rnd(); g.beginPath(); g.moveTo(rnd()*W, y); g.lineTo(rnd()*W, y + (rnd()-0.5)*2); g.stroke();
    }
    for (let i=0;i<90;i++){                      // scuffs + scratches
      const x = rnd()*W, y = rnd()*H, l = 6 + rnd()*30, a = rnd()*Math.PI;
      g.strokeStyle = 'rgba(70,72,70,' + (0.08 + rnd()*0.14) + ')'; g.lineWidth = 0.6 + rnd()*1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a)*l, y + Math.sin(a)*l); g.stroke();
    }
    for (let i=0;i<55;i++){                      // grime / water spots
      const x = rnd()*W, y = rnd()*H, r = 4 + rnd()*26, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(70,64,52,' + (0.10 + rnd()*0.16) + ')'); gr.addColorStop(1, 'rgba(70,64,52,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r*2, r*2);
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const kegTex = kegSteelTex();
  const KEG_SHAPES = {
    // [radius × R, height × H] from the bottom of the skirt to the top of the chime
    half:  { rings:[0.30, 0.50, 0.70], bands:[[0.335, 0.465], [0.535, 0.665]] },
    sixth: { rings:[0.20, 0.56, 0.80], bands:[[0.60, 0.70], [0.42, 0.52]] },
  };
  function makeKegGeos(kind){
    const R = kind.dia/2, H = kind.h, S = KEG_SHAPES[kind.key];
    const prof = [[0.90,0],[0.97,0.008],[0.97,0.105],[0.93,0.122],[0.985,0.14],[1.0,0.165]];
    for (const r of S.rings) prof.push([1.0, r - 0.024], [1.045, r - 0.008], [1.045, r + 0.008], [1.0, r + 0.024]);
    prof.push([1.0,0.835],[0.965,0.86],[0.93,0.872],[0.975,0.884],[0.985,0.892],[0.985,0.99],[0.945,1.0]);
    const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r*R, y*H)), 48);
    const headProf = []; for (let i=0;i<=8;i++){ const f = i/8; headProf.push(new THREE.Vector2(Math.max(0.001, 0.93*R*Math.cos(f*Math.PI/2)), 0.866*H + 0.035*H*Math.sin(f*Math.PI/2))); }
    headProf.reverse();
    const head = new THREE.LatheGeometry(headProf, 40);                                     // domed top head
    const topY = 0.866*H + 0.035*H;
    const neck = new THREE.CylinderGeometry(0.092, 0.1, 0.11, 24); neck.translate(0, topY + 0.045, 0);     // Sankey valve neck
    const collar = new THREE.TorusGeometry(0.088, 0.012, 8, 24); collar.rotateX(Math.PI/2); collar.translate(0, topY + 0.1, 0);
    const steelGeo = mergeGeos([body, head, neck, collar]);
    // dark parts: oval handle cut-outs in the chime + the valve opening
    const slotW = Math.min(0.40, 0.66*R), slotH = Math.min(0.075, 0.042*H);
    const slots = [-1, 1].map(s => { const b = new THREE.CapsuleGeometry(slotH/2, slotW - slotH, 4, 10); b.rotateZ(Math.PI/2); b.scale(1, 1, 0.12); b.translate(0, 0.945*H, s*0.982*R); return b; });
    const hole = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20); hole.translate(0, topY + 0.1, 0);
    const darkGeo = mergeGeos([...slots, hole]);
    // the two blue stripes
    const lin = h => new THREE.Color(h).convertSRGBToLinear();
    const parts = [];
    for (const [a, b] of S.bands){ const band = new THREE.CylinderGeometry(1.008*R, 1.008*R, (b - a)*H, 48, 1, true); band.translate(0, (a + b)/2*H, 0); parts.push([band, lin('#2b42a8')]); }
    const labelGeo = parts.length ? mergeGeos(parts) : null;
    [body, head, neck, collar, hole, ...slots, ...parts.map(p => p[0])].forEach(g => g.dispose());
    return { steelGeo, darkGeo, labelGeo };
  }
  const kegSteel = new THREE.MeshStandardMaterial({ color:0xb9bdba, map:kegTex, metalness:0.85, roughness:0.48, envMap:steelEnv, envMapIntensity:0.75, side:THREE.DoubleSide });
  const kegDark = new THREE.MeshStandardMaterial({ color:0x141716, roughness:0.7, metalness:0.1 });
  const kegLabel = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.55, metalness:0, side:THREE.DoubleSide });
  const pickMat = new THREE.MeshBasicMaterial({ visible:false });   // invisible hover boxes (one per pallet)
  // where each keg sits on its pallet (pallet-local feet; x = 40" side, z = 48" side)
  function kegSpots(kind){
    const S = [];
    if (kind.key === 'half'){       // 3-2-3 nested rows (16.1" kegs)
      const d = kind.dia, row = d*0.866;
      for (const [rx, n] of [[-row, 3], [0, 2], [row, 3]]) for (let i=0;i<n;i++) S.push([rx, (i - (n-1)/2)*d]);
    } else {                        // 4 x 5 grid (9.25" kegs)
      for (let ix=0;ix<4;ix++) for (let iz=0;iz<5;iz++) S.push([(ix - 1.5)*(PAL_X/4), (iz - 2)*(PAL_Z/5)]);
    }
    return S;
  }
  const kegCounts = { half: kegs ? Math.max(0, Math.floor(Number(kegs.half) || 0)) : 0, sixth: kegs ? Math.max(0, Math.floor(Number(kegs.sixth) || 0)) : 0 };
  // ---------- Where the packaging goes inside the building (2026-10-26) ----------
  // Same as before (Chad: "exactly where they are"): one line on the back-row line, starting a
  // little past CID-3 and running toward the front wall — 1/2 bbl kegs, 1/6 bbl kegs, cans,
  // lids, label rack. Each item asks for a block of floor (length along the line, rows deep);
  // a block that would hit the front wall starts a new line beside the last one, toward the
  // open aisle. x = block's start, z = first row's centre line.
  const INV_L = (917 - CX)*FT_PER_PX + 5.0, INV_R = IN_Z - 1.5;
  const inv = { x: INV_L, z: (68 - CZ)*FT_PER_PX, front: (68 - CZ)*FT_PER_PX };
  function invPlace(width, rows, rowStep, itemD, gap){
    if (inv.x > INV_L && inv.x + gap + width > INV_R){ inv.z = inv.front + 4.5 + itemD/2; inv.x = INV_L; }
    else if (inv.x > INV_L) inv.x += gap;
    const at = { x: inv.x, z: inv.z };
    inv.x += width;
    inv.front = Math.max(inv.front, inv.z + (rows - 1)*rowStep + itemD/2);
    return at;
  }
  const kegStacks = [];             // { kind, x, z, levels:[n kegs per pallet] }
  if (kegs){
    for (const kind of KEG_KINDS){
      const n = kegCounts[kind.key], nPal = Math.max(1, Math.ceil(n/kind.per));
      for (let s=0; s*PAL_PER_STACK < nPal; s++){
        const levels = [];
        for (let l=0; l<PAL_PER_STACK && s*PAL_PER_STACK + l < nPal; l++){ const i = s*PAL_PER_STACK + l; levels.push(Math.max(0, Math.min(kind.per, n - i*kind.per))); }
        kegStacks.push({ kind, levels });
      }
    }
    // Inside the building (2026-10-26): one line across the building behind the tanks, left
    // wall → right wall: 1/2 bbl stacks, then 1/6 bbl. Each size fills up to 4 stacks across;
    // more starts a new row in front of it (Chad picked "New row in front", 2026-10-06).
    const PER_ROW = 4, DX = PAL_X + 1.0, DZ = PAL_Z + 1.5;
    for (const kind of KEG_KINDS){
      const mine = kegStacks.filter(st => st.kind === kind); if (!mine.length) continue;
      const at = invPlace(Math.min(mine.length, PER_ROW)*DX - 1.0, Math.ceil(mine.length/PER_ROW), DZ, PAL_Z, 3.0);
      mine.forEach((st, i) => { st.x = at.x + PAL_X/2 + (i % PER_ROW)*DX; st.z = at.z + Math.floor(i/PER_ROW)*DZ; });
    }
  }
  const LEVEL_H = PAL_H + KEG_KINDS[0].h + 0.02;
  for (const kind of KEG_KINDS){
    const stacks = kegStacks.filter(s => s.kind === kind); if (!stacks.length) continue;
    const spots = kegSpots(kind), total = stacks.reduce((a, s) => a + s.levels.reduce((b, n) => b + n, 0), 0);
    let steelIM = null, darkIM = null, labelIM = null;
    if (total){
      const g = makeKegGeos(kind);
      steelIM = new THREE.InstancedMesh(g.steelGeo, kegSteel, total);
      darkIM = new THREE.InstancedMesh(g.darkGeo, kegDark, total);
      if (g.labelGeo){ labelIM = new THREE.InstancedMesh(g.labelGeo, kegLabel, total); labelIM.frustumCulled = false; scene.add(labelIM); }
      scene.add(steelIM); scene.add(darkIM);
    }
    const nPalAll = stacks.reduce((a, s) => a + s.levels.length, 0);
    let k = 0, palNo = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const st of stacks){
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(PAL_X*1.9, PAL_Z*1.7), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false, opacity:0.85 }));
      sh.rotation.x = -Math.PI/2; sh.position.set(st.x, 0.03, st.z); scene.add(sh);
      st.levels.forEach((n, l) => {
        const y0 = l*LEVEL_H;
        const p = makePallet(); p.position.set(st.x, y0, st.z); p.rotation.y = (l % 2 ? 0.012 : -0.008); scene.add(p);
        let seed = (palNo + 1)*977 + l*31; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
        for (let i=0;i<n;i++){
          const [sx, sz] = spots[i];
          v.set(st.x + sx + (rnd() - 0.5)*0.03, y0 + PAL_H, st.z + sz + (rnd() - 0.5)*0.03);
          e.set(0, rnd()*Math.PI*2, 0); q.setFromEuler(e);
          m4.compose(v, q, one); steelIM.setMatrixAt(k, m4); darkIM.setMatrixAt(k, m4); if (labelIM) labelIM.setMatrixAt(k, m4); k++;
        }
        palNo++;
        const info = { isPallet:true, kind, onHand: kegCounts[kind.key], pallets: nPalAll, palletNo: palNo, onThis: n,
          box: { x: st.x, y: y0 + LEVEL_H/2, z: st.z, w: PAL_X + 0.4, h: LEVEL_H, d: PAL_Z + 0.2 } };
        const pick = new THREE.Mesh(boardGeo, pickMat);
        pick.scale.set(info.box.w, info.box.h, info.box.d); pick.position.set(info.box.x, info.box.y, info.box.z);
        pick.userData.pallet = info; scene.add(pick); pickables.push(pick);
        pallets.push(info);
      });
    }
    if (steelIM){ steelIM.instanceMatrix.needsUpdate = darkIM.instanceMatrix.needsUpdate = true; if (labelIM) labelIM.instanceMatrix.needsUpdate = true; steelIM.frustumCulled = darkIM.frustumCulled = false; }   // three r147: no instance bounds
  }
  // soft green outline around the pallet the mouse is on (like a tank's hover glow)
  const palletHi = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color:0x8fd16e, transparent:true, opacity:0, depthWrite:false }));
  palletHi.visible = false; scene.add(palletHi);

  // ---------- Can pallets (Chad, 2026-10-06 — claude/tanks-can-pallets-plan.md) ----------
  // Empty cans as they ship: open end DOWN (dome bottoms up) on a black plastic 44" x 56" pallet,
  // a light gray plastic tier sheet under every layer, and on a full untouched pallet a dark gray
  // top frame + green straps (Chad's reference photo). 389 cans per layer for every size (Chad:
  // 12oz 22 layers = 8,558 · 16oz 16 = 6,224 · 19.2oz 14 = 5,446). EVERY can on hand is drawn —
  // full layers, then a partial top layer filled row by row. Counts = Packaging Inventory On Hand
  // (individual cans). One pallet per size even at 0 (empty pallet). Not stacked; continues the
  // back-row line right of the kegs; >4 pallets of one size → a new row in front.
  const CAN_KINDS = [
    { key:'c19', label:'19.2oz Cans', layers:14, h:7.5/12 },
    { key:'c16', label:'16oz Cans',   layers:16, h:6.18/12 },
    { key:'c12', label:'12oz Cans',   layers:22, h:4.83/12 },
  ];
  const PER_LAYER = 389, CAN_D = 2.6/12, CPAL_X = 44/12, CPAL_Z = 56/12, CPAL_H = 5.25/12, TIER = 0.09/12;
  // 389-can layer: 19 nested rows across the 44" side, alternating 21 / 20 cans along the 56" side
  // (= 390), last row one short → 389. Exact count; the real supplier pattern isn't known.
  const LAYER_SPOTS = (() => {
    const S = [], ROWS = 19, pitch = CAN_D*0.866;
    for (let r=0;r<ROWS;r++){
      let n = r % 2 ? 20 : 21; if (r === ROWS - 1) n = 20;
      const x = (r - (ROWS-1)/2)*pitch, z0 = -(n - 1)/2*CAN_D + (r === ROWS - 1 ? -CAN_D/2 : 0);
      for (let i=0;i<n;i++) S.push([x, z0 + i*CAN_D]);
    }
    return S;
  })();
  const canCounts = { c19: 0, c16: 0, c12: 0 };
  if (cans) for (const k of Object.keys(canCounts)) canCounts[k] = Math.max(0, Math.floor(Number(cans[k]) || 0));
  const canPlastic = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x1b1d1c).convertSRGBToLinear(), roughness:0.7, metalness:0 });
  const tierMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x9a9d98).convertSRGBToLinear(), roughness:0.8, metalness:0 });
  const frameMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x45484a).convertSRGBToLinear(), roughness:0.7, metalness:0 });
  const strapMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x2f8a3c).convertSRGBToLinear(), roughness:0.6, metalness:0 });
  const canMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0xb9b8ae).convertSRGBToLinear(), metalness:0.6, roughness:0.45, envMap:steelEnv, envMapIntensity:0.6 });
  // plastic can pallet: flat top deck, 3 x 3 feet, perimeter + center runners underneath
  function makePlasticPallet(){
    const p = new THREE.Group(), add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(boardGeo, canPlastic); m.scale.set(w, h, d); m.position.set(x, y, z); p.add(m); };
    const deck = 1.2/12, foot = 3.0/12, run = 1.05/12;
    add(CPAL_X, deck, CPAL_Z, 0, CPAL_H - deck/2, 0);
    for (const fx of [-1, 0, 1]) for (const fz of [-1, 0, 1]) add(5.5/12, foot, 6/12, fx*(CPAL_X/2 - 2.75/12), run + foot/2, fz*(CPAL_Z/2 - 3/12));
    for (const fx of [-1, 0, 1]) add(5.5/12, run, CPAL_Z, fx*(CPAL_X/2 - 2.75/12), run/2, 0);
    return p;
  }
  // one empty can, standing open end down: neck + opening at the bottom, dome bottom on top
  function makeCanGeo(h){
    const R = CAN_D/2*0.985, prof = [
      [0.76, 0.0], [0.80, 0.01], [0.80, 0.03], [0.88, 0.065], [0.98, 0.11], [1.0, 0.14],   // neck (open end) at the bottom
      [1.0, 0.94], [0.97, 0.965], [0.86, 0.995], [0.80, 1.0], [0.70, 0.985], [0.40, 0.955], [0.001, 0.945],   // stand ring + dome on top
    ].map(([r, y]) => new THREE.Vector2(r*R, y*h));
    return new THREE.LatheGeometry(prof, 10);   // low-poly: thousands of cans
  }
  const canPallets = [];
  {
    const DX = CPAL_X + 1.0, DZ = CPAL_Z + 1.5, PER_ROW = 4;
    for (const kind of CAN_KINDS){
      const n = canCounts[kind.key], per = PER_LAYER*kind.layers, nPal = Math.max(1, Math.ceil(n/per));
      const at = invPlace(Math.min(nPal, PER_ROW)*DX - 1.0, Math.ceil(nPal/PER_ROW), DZ, CPAL_Z, 3.0);
      const pals = [];
      for (let i=0;i<nPal;i++) pals.push({ kind, cans: Math.max(0, Math.min(per, n - i*per)), x: at.x + CPAL_X/2 + (i % PER_ROW)*DX, z: at.z + Math.floor(i/PER_ROW)*DZ, no: i + 1, of: nPal });
      canPallets.push(...pals);
    }
  }
  for (const kind of CAN_KINDS){
    const pals = canPallets.filter(p => p.kind === kind), total = pals.reduce((a, p) => a + p.cans, 0);
    const layerH = kind.h + TIER, per = PER_LAYER*kind.layers;
    let im = null, k = 0;
    if (total){ im = new THREE.InstancedMesh(makeCanGeo(kind.h), canMat, total); im.frustumCulled = false; scene.add(im); }
    const m4 = new THREE.Matrix4();
    for (const p of pals){
      const pal = makePlasticPallet(); pal.position.set(p.x, 0, p.z); scene.add(pal);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(CPAL_X*1.8, CPAL_Z*1.6), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false, opacity:0.85 }));
      sh.rotation.x = -Math.PI/2; sh.position.set(p.x, 0.03, p.z); scene.add(sh);
      const full = Math.floor(p.cans/PER_LAYER), part = p.cans % PER_LAYER, layers = full + (part ? 1 : 0);
      for (let l=0;l<layers;l++){
        const y0 = CPAL_H + l*layerH;
        const tier = new THREE.Mesh(boardGeo, tierMat); tier.scale.set(CPAL_X - 0.04, TIER, CPAL_Z - 0.04); tier.position.set(p.x, y0 + TIER/2, p.z); scene.add(tier);
        const nThis = l < full ? PER_LAYER : part;
        for (let i=0;i<nThis;i++){ const [sx, sz] = LAYER_SPOTS[i]; m4.makeTranslation(p.x + sx, y0 + TIER, p.z + sz); im.setMatrixAt(k++, m4); }
      }
      const topY = CPAL_H + layers*layerH;
      if (p.cans === per){             // full, untouched pallet: top frame + green straps
        const top = new THREE.Mesh(boardGeo, frameMat); top.scale.set(CPAL_X + 0.06, 0.12, CPAL_Z + 0.06); top.position.set(p.x, topY + 0.06, p.z); scene.add(top);
        for (const sz of [-CPAL_Z/4, CPAL_Z/4]) for (const sx of [-1, 1]){
          const s = new THREE.Mesh(boardGeo, strapMat); s.scale.set(0.02, topY + 0.1, 0.06); s.position.set(p.x + sx*(CPAL_X/2 + 0.04), (topY + 0.1)/2, p.z + sz); scene.add(s);
        }
      }
      const hgt = Math.max(topY + 0.15, CPAL_H + 0.3);
      const info = { isPallet:true, isCans:true, kind, onHand: canCounts[kind.key], pallets: canCounts[kind.key] ? p.of : 0, palletNo: p.no, onThis: p.cans, fullLayers: full, partLayer: part,
        box: { x: p.x, y: hgt/2, z: p.z, w: CPAL_X + 0.2, h: hgt, d: CPAL_Z + 0.2 } };
      const pick = new THREE.Mesh(boardGeo, pickMat); pick.scale.set(info.box.w, info.box.h, info.box.d); pick.position.set(info.box.x, info.box.y, info.box.z);
      pick.userData.pallet = info; scene.add(pick); pickables.push(pick);
    }
    if (im) im.instanceMatrix.needsUpdate = true;
  }

  // ---------- Lid pallet (Chad, 2026-10-06 — claude/tanks-lid-pallets-plan.md) ----------
  // 202 LOE ends come in paper sleeves ("chutes") of 500 (Chad). Pallet layout from the
  // supplier listing for 500-per-sleeve 202 ends: 361 sleeves = 180,500 lids per pallet →
  // drawn as 19 layers × 19 sleeves (assumption — confirm on a delivery). Like Chad's photo:
  // sleeves lie on their side running front-to-back (round ends face the front — Chad, after
  // v63: "lets have the lids running the other way"), filling from the left side, on a yellow wooden pallet with a black plastic sheet; a full untouched pallet
  // is stretch-wrapped with a cardboard top and two green straps. Every sleeve is drawn: lids
  // ÷ 500, the last partial sleeve shorter. Count = Packaging Inventory On Hand (individual
  // lids); empty pallet at 0. Sits on the back-row line right of the can pallets.
  const LID_PER_SLEEVE = 500, SLV_PER_LAYER = 19, SLV_LAYERS = 19, LIDS_FULL = LID_PER_SLEEVE*SLV_PER_LAYER*SLV_LAYERS;
  const SLV_D = 2.35/12, SLV_L = 48/12, LPAL_X = SLV_D*SLV_PER_LAYER + 0.4/12, LPAL_Z = 48/12;   // chutes run front-to-back (Chad)
  const lidCount = Math.max(0, Math.floor(Number(lids) || 0));
  const kraft = new THREE.MeshStandardMaterial({ color:new THREE.Color(0xb48a5a).convertSRGBToLinear(), roughness:0.85, metalness:0 });
  const kraftEnd = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x8e6a42).convertSRGBToLinear(), roughness:0.8, metalness:0 });
  const blackSheet = new THREE.MeshStandardMaterial({ color:new THREE.Color(0x151616).convertSRGBToLinear(), roughness:0.6, metalness:0 });
  const wrapMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.15, metalness:0, transparent:true, opacity:0.16, depthWrite:false });
  const cardMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(0xa47c4c).convertSRGBToLinear(), roughness:0.9, metalness:0 });
  const lidPallets = [];
  {
    const nPal = Math.max(1, Math.ceil(lidCount/LIDS_FULL)), DX = LPAL_X + 1.0, DZ = 6.0;
    const at = invPlace(Math.min(nPal, 4)*DX - 1.0, Math.ceil(nPal/4), DZ, LPAL_Z, 3.0);
    for (let i=0;i<nPal;i++) lidPallets.push({ lids: Math.max(0, Math.min(LIDS_FULL, lidCount - i*LIDS_FULL)), x: at.x + LPAL_X/2 + (i % 4)*DX, z: at.z + Math.floor(i/4)*DZ, no: i + 1, of: nPal });
  }
  {
    const sleeves = lidPallets.reduce((a, p) => a + Math.ceil(p.lids/LID_PER_SLEEVE), 0);
    let body = null, ends = null, k = 0;
    if (sleeves){
      const g = new THREE.CylinderGeometry(SLV_D/2*0.97, SLV_D/2*0.97, 1, 12, 1, true); g.rotateX(Math.PI/2);      // along z (front-to-back), length 1 (scaled)
      const e = new THREE.CylinderGeometry(SLV_D/2*0.962, SLV_D/2*0.962, 1, 12, 1, false); e.rotateX(Math.PI/2);   // end caps just inside the paper tube
      body = new THREE.InstancedMesh(g, kraft, sleeves); ends = new THREE.InstancedMesh(e, kraftEnd, sleeves);
      body.frustumCulled = ends.frustumCulled = false; scene.add(ends); scene.add(body);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const p of lidPallets){
      const pal = makePallet(LPAL_X, LPAL_Z); pal.position.set(p.x, 0, p.z); scene.add(pal);
      const deckTop = (0.75*2 + 3.5)/12;
      const sheet = new THREE.Mesh(boardGeo, blackSheet); sheet.scale.set(LPAL_X, 0.04, LPAL_Z); sheet.position.set(p.x, deckTop + 0.02, p.z); scene.add(sheet);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(LPAL_X*1.7, LPAL_Z*1.7), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false, opacity:0.85 }));
      sh.rotation.x = -Math.PI/2; sh.position.set(p.x, 0.03, p.z); scene.add(sh);
      const y0 = deckTop + 0.04, n = Math.ceil(p.lids/LID_PER_SLEEVE);
      for (let i=0;i<n;i++){
        const layer = Math.floor(i/SLV_PER_LAYER), col = i % SLV_PER_LAYER;
        const lidsHere = Math.min(LID_PER_SLEEVE, p.lids - i*LID_PER_SLEEVE), len = SLV_L*lidsHere/LID_PER_SLEEVE;
        v.set(p.x - LPAL_X/2 + 0.2/12 + SLV_D/2 + col*SLV_D, y0 + SLV_D/2 + layer*SLV_D*0.995, p.z - SLV_L/2 + len/2);   // fills from the left side
        sc.set(1, 1, len); m4.compose(v, q, sc);
        body.setMatrixAt(k, m4); sc.set(1, 1, len*0.998); m4.compose(v, q, sc); ends.setMatrixAt(k, m4); k++;
      }
      const layers = Math.ceil(n/SLV_PER_LAYER), topY = y0 + layers*SLV_D*0.995;
      if (p.lids === LIDS_FULL){         // full, untouched: stretch wrap + cardboard top + green straps
        const card = new THREE.Mesh(boardGeo, cardMat); card.scale.set(LPAL_X + 0.04, 0.03, SLV_L + 0.04); card.position.set(p.x, topY + 0.015, p.z); scene.add(card);
        const wrap = new THREE.Mesh(boardGeo, wrapMat); wrap.scale.set(LPAL_X + 0.08, topY - deckTop + 0.1, SLV_L + 0.08); wrap.position.set(p.x, (topY + deckTop)/2 + 0.03, p.z); wrap.renderOrder = 4; scene.add(wrap);
        for (const sz of [-SLV_L/4, SLV_L/4]) for (const sx of [-1, 1]){   // straps on the long sides
          const s = new THREE.Mesh(boardGeo, strapMat); s.scale.set(0.02, topY + 0.05, 0.06); s.position.set(p.x + sx*(LPAL_X/2 + 0.05), (topY + 0.05)/2, p.z + sz); scene.add(s);
        }
      }
      const hgt = Math.max(topY + 0.1, deckTop + 0.4);
      const info = { isPallet:true, isLids:true, onHand: lidCount, pallets: lidCount ? p.of : 0, palletNo: p.no, onThis: p.lids,
        box: { x: p.x, y: hgt/2, z: p.z, w: LPAL_X + 0.2, h: hgt, d: LPAL_Z + 0.2 } };
      const pick = new THREE.Mesh(boardGeo, pickMat); pick.scale.set(info.box.w, info.box.h, info.box.d); pick.position.set(info.box.x, info.box.y, info.box.z);
      pick.userData.pallet = info; scene.add(pick); pickables.push(pick);
    }
    if (body){ body.instanceMatrix.needsUpdate = ends.instanceMatrix.needsUpdate = true; }
  }


  // ---------- Label rolls on a pallet rack (Chad, 2026-10-06 — claude/tanks-label-shelf-plan.md) ----------
  // Plain steel rack (steel uprights, beams and shelf decks — no paint colors, Chad) right of the lid pallet: top shelf
  // 19.2oz, middle 16oz, bottom 12oz. One stack per product, rolls lying flat (like Chad's photo:
  // wide, squat roll, black plastic core with spokes, wound stock showing as rings on top).
  // 2,000 labels per roll; On Hand = individual labels → full rolls + one smaller part roll (its
  // diameter shrinks with what's left, like a used roll). Product name tag on the beam under each
  // stack. Counts = Inventory & Allocation → Label Inventory On Hand (live in the app).
  const LBL_PER_ROLL = 2000, ROLL_R = 6.5/12, CORE_R = 1.75/12;
  const LBL_SHELVES = [   // top → bottom
    { key:'c19', label:'19.2oz Labels', h:7.1/12, deckY:5.55 },
    { key:'c16', label:'16oz Labels',   h:5.9/12, deckY:2.9 },
    { key:'c12', label:'12oz Labels',   h:4.6/12, deckY:0.5 },
  ];
  const lblRows = (Array.isArray(labels) ? labels : []).map(r => ({ name: String(r.name || ''), size: r.size, onHand: Math.max(0, Math.floor(Number(r.onHand) || 0)) }))
    .filter(r => r.name && LBL_SHELVES.some(s => s.key === r.size));
  const STACK_W = ROLL_R*2 + 0.35, RACK_D = 3.5, RACK_TOP = 8.2, BEAM_H = 0.34;
  const perShelf = LBL_SHELVES.map(s => lblRows.filter(r => r.size === s.key));
  const rackSlots = Math.max(6, ...perShelf.map(a => a.length));
  const MID_GAP = rackSlots*STACK_W + 0.6 > 9 ? 0.45 : 0;   // room for the middle upright between bays
  const RACK_W = rackSlots*STACK_W + 0.6 + MID_GAP;
  const slotX = i => -RACK_W/2 + 0.3 + STACK_W/2 + i*STACK_W + (MID_GAP && i >= Math.ceil(rackSlots/2) ? MID_GAP : 0);
  const rackAt = labels ? invPlace(RACK_W, 1, 0, RACK_D, 4.0) : { x: 0, z: 0 };
  const rack = { x: rackAt.x + RACK_W/2, z: rackAt.z, w: RACK_W };
  const lblStacks = [];
  if (labels){
    const lin = h => new THREE.Color(h).convertSRGBToLinear();
    // plain steel everywhere (Chad: "steel frame, steel shelf, get rid of all those colors")
    const frameSteel = new THREE.MeshStandardMaterial({ color: lin('#9aa09d'), roughness: 0.42, metalness: 0.85, envMap: steelEnv, envMapIntensity: 0.6 });
    const beamSteel = new THREE.MeshStandardMaterial({ color: lin('#a7aca9'), roughness: 0.38, metalness: 0.85, envMap: steelEnv, envMapIntensity: 0.6 });
    const deckMat = new THREE.MeshStandardMaterial({ color: lin('#8e9491'), roughness: 0.5, metalness: 0.8, envMap: steelEnv, envMapIntensity: 0.5 });
    const add = (mat, w, h, d, x, y, z) => { const m = new THREE.Mesh(boardGeo, mat); m.scale.set(w, h, d); m.position.set(x, y, z); scene.add(m); return m; };
    // uprights (one frame at each end + one in the middle when wide), with cross braces
    const frames = MID_GAP ? [-RACK_W/2, -RACK_W/2 + 0.3 + Math.ceil(rackSlots/2)*STACK_W + MID_GAP/2, RACK_W/2] : [-RACK_W/2, RACK_W/2];
    for (const fx of frames){
      for (const fz of [-RACK_D/2, RACK_D/2]) add(frameSteel, 0.25, RACK_TOP, 0.18, rack.x + fx, RACK_TOP/2, rack.z + fz);
      for (let yb = 0.3; yb + 1.6 <= RACK_TOP - 0.3; yb += 1.6){   // braces stay inside the frame
        const br = add(frameSteel, 0.06, Math.hypot(RACK_D, 1.6), 0.06, rack.x + fx, yb + 0.8, rack.z); br.rotation.x = Math.atan2(RACK_D, 1.6);
      }
      add(frameSteel, 0.4, 0.05, RACK_D + 0.3, rack.x + fx, 0.025, rack.z);   // foot plate
    }
    // each level: front + back orange step beams and a wood deck
    for (const s of LBL_SHELVES){
      for (const bz of [-RACK_D/2, RACK_D/2]) add(beamSteel, RACK_W, BEAM_H, 0.14, rack.x, s.deckY - BEAM_H/2, rack.z + bz);
      add(deckMat, RACK_W - 0.1, 0.06, RACK_D, rack.x, s.deckY + 0.03, rack.z);   // steel shelf deck
    }
    add(beamSteel, RACK_W, BEAM_H, 0.14, rack.x, RACK_TOP - 0.3, rack.z + RACK_D/2);
    add(beamSteel, RACK_W, BEAM_H, 0.14, rack.x, RACK_TOP - 0.3, rack.z - RACK_D/2);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(RACK_W + 2, RACK_D + 2), new THREE.MeshBasicMaterial({ map:shadowTex, transparent:true, depthWrite:false, opacity:0.7 }));
    sh.rotation.x = -Math.PI/2; sh.position.set(rack.x, 0.03, rack.z); scene.add(sh);

    // roll pieces (shared): side band (printed stock, one color per product), top/bottom faces
    // (liner rings), black core with spokes
    function ringsTex(){
      const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
      g.fillStyle = '#9d978d'; g.fillRect(0, 0, N, N);
      for (let r = 20; r < N/2; r += 1.5){ g.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '60,58,54' : '225,222,214') + ',' + (0.12 + Math.random()*0.18) + ')'; g.lineWidth = 1; g.beginPath(); g.arc(N/2, N/2, r, 0, Math.PI*2); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    }
    const faceTex = ringsTex();
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35, metalness: 0.05 });
    const coreMat = new THREE.MeshStandardMaterial({ color: lin('#141515'), roughness: 0.6 });
    const stockMat = new THREE.MeshStandardMaterial({ color: lin('#b9b2a6'), roughness: 0.4, metalness: 0.05 });   // plain label stock, no colors (Chad)
    const bandMat = () => stockMat;
    const sideGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    const faceGeo = new THREE.RingGeometry(CORE_R/ROLL_R, 1, 40, 1); faceGeo.rotateX(-Math.PI/2);
    const coreGeo = new THREE.CylinderGeometry(CORE_R, CORE_R, 1, 20, 1, true);
    const spokeGeo = new THREE.BoxGeometry(CORE_R*2*0.92, 0.04, 0.02);
    function makeRoll(name, h, labelsOn){
      const g = new THREE.Group();
      const frac = labelsOn/LBL_PER_ROLL, R = Math.sqrt(CORE_R*CORE_R + (ROLL_R*ROLL_R - CORE_R*CORE_R)*frac);   // used roll = smaller
      const side = new THREE.Mesh(sideGeo, bandMat(name)); side.scale.set(R, h*0.98, R); side.position.y = h/2; g.add(side);
      for (const y of [0.005, h - 0.005]){ const f = new THREE.Mesh(faceGeo, faceMat); f.scale.set(R, 1, R); f.position.y = y; if (y < h/2) f.rotation.x = Math.PI; g.add(f); }
      const core = new THREE.Mesh(coreGeo, coreMat); core.scale.y = h; core.position.y = h/2; g.add(core);
      coreMat.side = THREE.DoubleSide;
      for (let k = 0; k < 4; k++){ const sp = new THREE.Mesh(spokeGeo, coreMat); sp.rotation.y = k*Math.PI/4; sp.position.y = h - 0.03; g.add(sp); }
      return g;
    }
    // name tag on the front beam under each stack
    function tagTex(name, n){
      const c = document.createElement('canvas'); c.width = 256; c.height = 80; const g = c.getContext('2d');
      g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 256, 80);
      g.fillStyle = '#1b1d1c'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 30; g.font = '700 ' + fs + 'px ' + FONT; while (g.measureText(name).width > 240 && fs > 14){ fs -= 2; g.font = '700 ' + fs + 'px ' + FONT; }
      g.fillText(name, 128, 28);
      g.font = '500 24px ' + MONO; g.fillStyle = '#4a4f4c'; g.fillText(n.toLocaleString('en-US'), 128, 60);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
    }
    LBL_SHELVES.forEach((s, si) => {
      const rows = perShelf[si];
      const clear = (si === 0 ? RACK_TOP - 0.3 - BEAM_H : LBL_SHELVES[si - 1].deckY - BEAM_H) - (s.deckY + 0.06) - 0.1;
      const maxH = Math.max(1, Math.floor(clear/s.h));
      rows.forEach((r, i) => {
        const x = rack.x + slotX(i), z = rack.z + 0.2;
        const full = Math.floor(r.onHand/LBL_PER_ROLL), part = r.onHand % LBL_PER_ROLL, rolls = full + (part ? 1 : 0);
        for (let k = 0; k < rolls; k++){
          const lv = k % maxH, col = Math.floor(k/maxH);       // too tall for the shelf → next to it, behind
          const roll = makeRoll(r.name, s.h, k < full ? LBL_PER_ROLL : part);
          roll.position.set(x, s.deckY + 0.06 + lv*s.h, z - col*(ROLL_R*2 + 0.1)); scene.add(roll);
        }
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(STACK_W - 0.12, 0.3), new THREE.MeshBasicMaterial({ map: tagTex(r.name, r.onHand), toneMapped: false }));
        tag.position.set(x, s.deckY - BEAM_H/2, rack.z + RACK_D/2 + 0.08); scene.add(tag);
        const info = { isPallet:true, isLabels:true, name: r.name, shelf: s, onHand: r.onHand, full, part,
          box: { x, y: s.deckY + 0.06 + Math.max(1, Math.min(rolls, maxH))*s.h/2, z, w: STACK_W - 0.05, h: Math.max(1, Math.min(rolls, maxH))*s.h + 0.1, d: RACK_D - 0.2 } };
        const pick = new THREE.Mesh(boardGeo, pickMat); pick.scale.set(info.box.w, info.box.h, info.box.d); pick.position.set(info.box.x, info.box.y, info.box.z);
        pick.userData.pallet = info; scene.add(pick); pickables.push(pick);
        lblStacks.push(info);
      });
    });
  }

  // ---------- Count windows over the pallets (Chad, 2026-10-06) ----------
  // One always-visible window per item, floating above that item's pallets and always facing
  // the camera, showing the total On Hand — so nobody has to hover/click to see it. Same
  // see-through green glass look as the tank hover window. Drawn as page elements over the 3D
  // view (crisp text), moved every frame to follow the pallets; click-through.
  const fmtN = n => n.toLocaleString('en-US');
  const escT = v => String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tagHost = canvas.parentElement;
  const tagSpecs = [];
  for (const kind of KEG_KINDS){
    const st = kegStacks.filter(s => s.kind === kind); if (!st.length) continue;
    const n = kegCounts[kind.key], pal = n ? st.reduce((a, s) => a + s.levels.length, 0) : 0;
    tagSpecs.push({ label: kind.label, count: n, unit: n === 1 ? 'keg' : 'kegs', sub: pal + (pal === 1 ? ' pallet' : ' pallets'),
      x: (Math.min(...st.map(s => s.x)) + Math.max(...st.map(s => s.x)))/2, z: Math.min(...st.map(s => s.z)), top: Math.max(...st.map(s => s.levels.length))*LEVEL_H });
  }
  for (const kind of CAN_KINDS){
    const ps = canPallets.filter(p => p.kind === kind); if (!ps.length) continue;
    const n = canCounts[kind.key], layersOf = c => Math.ceil(c/PER_LAYER);
    tagSpecs.push({ label: kind.label, count: n, unit: n === 1 ? 'can' : 'cans', sub: n ? ps.length + (ps.length === 1 ? ' pallet' : ' pallets') : 'Empty pallet',
      x: (Math.min(...ps.map(p => p.x)) + Math.max(...ps.map(p => p.x)))/2, z: Math.min(...ps.map(p => p.z)),
      top: CPAL_H + Math.max(...ps.map(p => layersOf(p.cans)))*(kind.h + TIER) });
  }
  if (lidPallets.length){
    const n = lidCount, ch = Math.ceil(n/LID_PER_SLEEVE), layers = Math.ceil(Math.min(ch, SLV_PER_LAYER*SLV_LAYERS)/SLV_PER_LAYER);
    tagSpecs.push({ label: '202 LOE Ends (Lids)', count: n, unit: n === 1 ? 'lid' : 'lids', sub: n ? fmtN(ch) + (ch === 1 ? ' chute' : ' chutes') : 'Empty pallet',
      x: (Math.min(...lidPallets.map(p => p.x)) + Math.max(...lidPallets.map(p => p.x)))/2, z: Math.min(...lidPallets.map(p => p.z)), top: (5/12) + 0.04 + layers*SLV_D });
  }
  if (labels) LBL_SHELVES.forEach((s, si) => {
    const n = perShelf[si].reduce((a, r) => a + r.onHand, 0), rolls = perShelf[si].reduce((a, r) => a + Math.ceil(r.onHand/LBL_PER_ROLL), 0);
    // Chad: "we need total of each brands label" → each shelf's window lists every brand + its labels
    tagSpecs.push({ label: s.label, count: n, unit: n === 1 ? 'label' : 'labels', sub: fmtN(rolls) + (rolls === 1 ? ' roll' : ' rolls'),
      rows: perShelf[si].map(r => [r.name, r.onHand]), x: rack.x + (si - 1)*rack.w/3, z: rack.z, top: RACK_TOP });
  });
  // all windows on one line in the air (Chad: "line them up"): just above the tallest pallet stack
  const tagY = Math.max(0, ...tagSpecs.map(t => t.top)) + 1.2;
  // (inside the building the items can run on more than one line — each line's windows share
  // that line's z instead of all being pulled to the back line)
  for (const t of tagSpecs){ const line = tagSpecs.filter(o => Math.abs(o.z - t.z) < 3); t.lineZ = Math.min(...line.map(o => o.z)); }
  tagSpecs.forEach(t => { t.z = t.lineZ; });
  const countTags = tagSpecs.map(t => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:0;top:0;z-index:2;pointer-events:none;white-space:nowrap;text-align:center;' +
      'padding:7px 12px 8px;border-radius:14px;color:#E8EDEA;font-family:' + FONT + ';' +
      'background:linear-gradient(155deg,rgba(106,188,70,0.18),rgba(106,188,70,0.04) 50%,rgba(255,255,255,0.03)),rgba(10,15,13,0.55);' +
      'border:1px solid rgba(143,209,110,0.38);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
      'box-shadow:0 10px 28px rgba(0,0,0,0.38),0 0 18px rgba(106,188,70,0.12);transform-origin:50% 100%;will-change:transform;visibility:hidden';
    if (t.rows){                     // label shelves: one line per brand
      el.style.textAlign = 'left';
      el.innerHTML =
        '<div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#A3ADA8;text-align:center;margin-bottom:4px">' + escT(t.label) + '</div>' +
        (t.rows.length ? t.rows.map(([nm, v]) => '<div style="display:flex;justify-content:space-between;gap:14px;font-size:12.5px;line-height:1.5"><span>' + escT(nm) + '</span>' +
          '<span style="font-family:' + MONO + ';font-weight:600;color:' + (v ? '#F2F7F0' : '#8A948F') + '">' + fmtN(v) + '</span></div>').join('')
          : '<div style="font-size:12px;color:#8A948F;text-align:center">None</div>');
      tagHost.appendChild(el);
      return { el, pos: new THREE.Vector3(t.x, tagY, t.z) };
    }
    el.innerHTML =
      '<div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#A3ADA8">' + escT(t.label) + '</div>' +
      '<div style="font-family:' + MONO + ';font-size:20px;font-weight:600;line-height:1.15;color:' + (t.count ? '#F2F7F0' : '#8A948F') + '">' + fmtN(t.count) + ' ' +
        '<span style="font-family:' + FONT + ';font-size:12px;font-weight:500;color:#A3ADA8">' + t.unit + '</span></div>' +
      '<div style="font-size:11px;color:#8FD16E">' + escT(t.sub) + '</div>';
    tagHost.appendChild(el);
    return { el, pos: new THREE.Vector3(t.x, tagY, t.z) };
  });
  const tagV = new THREE.Vector3();
  function updateCountTags(){
    const w = tagHost.clientWidth, h = tagHost.clientHeight, vis = [];
    // outside the building with a solid wall in between → the windows (inside) are hidden too
    if (walls.some(wl => wl.op > 0.6 && wl.outside(toBld(camera.position, wlP)) > 0)){ for (const t of countTags) t.el.style.visibility = 'hidden'; return; }
    for (const t of countTags){
      tagV.copy(t.pos).project(camera);
      const dist = camera.position.distanceTo(t.pos);
      if (tagV.z > 1 || tagV.z < -1 || Math.abs(tagV.x) > 1.2 || Math.abs(tagV.y) > 1.2 || dist > 260){ t.el.style.visibility = 'hidden'; continue; }
      // Size follows distance (Chad: "smaller the farther you are away … normal size as you get
      // closer", then "you shrunk them too much, maybe try half of what you did"): full size
      // within ~60 ft, then shrinks with distance (60 ÷ distance)…
      t.s = Math.min(1.0, 60/dist);
      t.x = (tagV.x + 1)/2*w; t.y = (1 - tagV.y)/2*h; t.dist = dist; t.w0 = t.el.offsetWidth;
      vis.push(t);
    }
    // …but never wider than the gap to its neighbours, so they can't pile up when zoomed out
    vis.sort((a, b) => a.x - b.x);
    for (let i=0;i<vis.length-1;i++){
      const a = vis[i], b = vis[i+1], gap = Math.hypot(b.x - a.x, b.y - a.y);
      const fit = (2*gap*0.94)/(a.w0 + b.w0);
      if (fit < a.s) a.s = fit;
      if (fit < b.s) b.s = fit;
    }
    for (const t of vis){
      if (t.s < 0.12){ t.el.style.visibility = 'hidden'; continue; }
      t.el.style.visibility = 'visible';
      t.el.style.opacity = t.dist > 200 ? String(Math.max(0, (260 - t.dist)/60)) : '1';
      t.el.style.transform = 'translate(' + (t.x - t.w0/2) + 'px,' + (t.y - t.el.offsetHeight) + 'px) scale(' + t.s.toFixed(3) + ')';
    }
  }


  // ---------- Selection (the details card itself is drawn by React in TanksClient) ----------
  const byName = n => tanks.find(t => t.name === n);
  let selected = null;
  function stageLabel(t){
    if (t.volume <= 0.05) return 'Empty';
    const st = t.stageName || t.status;
    return st === 'Ready' ? 'Ready For Packaging' : st;
  }
  function infoFor(t){
    const full = t.volume > 0.05;
    return { name: t.name, capacity: t.capacity, volume: t.volume, status: stageLabel(t),
      product: full ? (t.spec.product || '') : '', batch: full ? (t.spec.batch || '') : '', color: t.color };
  }
  function select(t){
    selected = t || null;
    if (t){ ring.position.set(t.group.position.x, 0.04, t.group.position.z); ring.scale.setScalar(t.Rft); }
    if (onSelect) onSelect(t ? infoFor(t) : null);
  }

  // ---------- Hover snapshot (FV16 only for now; sample data) ----------
  const STAGE = {
    'Fermenting':          { bg:'rgba(255,153,0,0.18)',  fg:'#FFC266' },
    'Dry Hopping':         { bg:'rgba(200,230,80,0.18)', fg:'#DCEB7A' },
    'Cold Crashing':       { bg:'rgba(51,153,255,0.18)', fg:'#8EC3FF' },
    'Carbonating':         { bg:'rgba(170,130,255,0.20)',fg:'#CDB4FF' },
    'Ready For Packaging': { bg:'rgba(106,188,70,0.30)', fg:'#CDEFBD' },
  };
  // Sample batch for FV16 (until real days/status/tasks come from Ekos / the batch tasks).
  // Shown at the "Carbonating" stage, the same as the approved preview.
  const SNAP = {
    FV16: {
      phase: 'carb',
      tasks: [               // Chad's order: dump yeast → dry hop (~3 days) → cold crash …
        { day: 7,  key: 'dump',   name: 'Dump yeast' },
        { day: 8,  key: 'dryhop', name: 'Dry hop' },
        { day: 11, key: 'grav',   name: 'Gravity check + diacetyl test' },
        { day: 11, key: 'crash',  name: 'Set to cold crash (34°F)' },
        { day: 14, key: 'fine',   name: 'Add fining' },
        { day: 15, key: 'carb',   name: 'Carbonating' },
        { day: 17, key: 'carbck', name: 'Carb check: target 2.5 volumes' },
        { day: 18, key: 'qc',     name: 'Final QC tasting' },
      ],
    },
  };
  const PHASE = {
    ferm:   { days: 6, stage: 'Fermenting',  doneKeys: [] },
    dumped: { days: 7, stage: 'Fermenting',  doneKeys: ['dump'] },
    dryhop: { days: 9, stage: 'Dry Hopping', doneKeys: ['dump', 'dryhop'] },
    crash:  { days: 12, stage: 'Cold Crashing', doneKeys: ['dump', 'dryhop', 'grav', 'crash'] },
    carb:   { days: 15, stage: 'Carbonating',   doneKeys: ['dump', 'dryhop', 'grav', 'crash', 'fine'] },
    done:   { days: 18, stage: 'Ready For Packaging', doneKeys: null },
  };
  function tasksLeft(d){ const ph = PHASE[d.phase]; return ph.doneKeys === null ? [] : d.tasks.filter(k => !ph.doneKeys.includes(k.key)); }
  // Turns a batch's task progress into what the tank shows (yeast, dry hop, cold crash, carbonating)
  function applyStage(t){
    const d = SNAP[t.name]; if (!d) return;
    const left = tasksLeft(d);
    t.crash = d.phase === 'crash';            // cold crash: still beer + snowflake indicator
    t.carb = d.phase === 'carb';              // carbonating: carb stone + tiny bubbles, no foam
    t.status = d.phase === 'done' ? 'Ready' : t.crash ? 'Cold Crashing' : t.carb ? 'Carbonating' : 'Fermenting';
    t.yeastOn = left.some(k => k.key === 'dump');                                         // white yeast until "Dump yeast" is done
    t.dryHop = !left.some(k => k.key === 'dryhop') && left.some(k => k.key === 'crash');   // dry hop done, not yet cold crashed
    t.tempF = { ferm: 68, dumped: 67, dryhop: 63, crash: 33, carb: 34, done: 34 }[d.phase];   // sample temps per stage
    t.stageName = d.phase === 'done' ? 'Ready For Packaging' : PHASE[d.phase].stage;
    applyLook(t); drawTemp(t); drawPlate(t);
  }
  if (!LIVE.size) applyStage(byName('FV16'));

  const viewerEl = canvas.parentElement;
  let snapTank = null, hoverSince = 0, overSnap = false, hideTimer = null;
  let lastPointer = { x: 0, y: 0 }, snapAt = null;
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const DAY = 86400000;
  const dayNum = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const todayNum = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY; };
  const shortDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const DONE_HTML = '<div class="tk-all-done"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A6DC8B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>All tasks completed</div>';
  function fillSnapLive(t){
    const r = t.live, stage = t.stageName || 'Fermenting', st = STAGE[stage] || STAGE.Fermenting;
    const start = r.start_date ? dayNum(r.start_date) : null;
    const days = start === null ? null : Math.max(0, todayNum() - start);
    const left = Array.isArray(r.tasks_left) ? r.tasks_left : [];
    const when = k => k.date ? (start !== null ? 'Day ' + (dayNum(k.date) - start + 1) : shortDate(k.date)) : '—';
    const tasks = !left.length ? DONE_HTML
      : '<div class="tk-tasks-h"><span>Tasks left</span><span>' + left.length + '</span></div><div class="tk-tasks">' +
        left.map((k,i) => '<div class="tk-task' + (i===0?' next':'') + (k.overdue?' late':'') + '"><span class="d">' + esc(when(k)) + '</span><span class="n">' + esc(k.title) + (k.overdue ? ' <b class="late-tag">Overdue</b>' : '') + '</span></div>').join('') + '</div>';
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:' + esc(t.color) + '"></span><span>' + esc(t.spec.product) + '</span></div>' +
      '<div class="tk-snap-tank">' + esc(t.name) + ' · ' + t.capacity + ' bbl unitank' + (r.batch_title ? ' · ' + esc(r.batch_title) : '') + '</div>' +
      '<div class="tk-snap-row"><span>Days in tank</span><span class="tk-num">' + (days === null ? '—' : days + (days === 1 ? ' day' : ' days')) + '</span></div>' +
      '<div class="tk-snap-row"><span>Left in tank</span><span class="tk-num">' + t.volume.toFixed(2) + ' bbl</span></div>' +
      '<div class="tk-snap-row"><span>Status</span><span class="tk-snap-pill" style="background:' + st.bg + ';color:' + st.fg + '">' + esc(stage) + '</span></div>' +
      tasks;
  }
  // Keg pallet hover window (Chad, 2026-10-06): how many of that keg size are on hand.
  const fmt = n => n.toLocaleString('en-US');
  function fillSnapCans(p){
    const n = p.onHand, per = PER_LAYER*p.kind.layers;
    const thisTxt = !p.onThis ? 'Empty pallet' : p.onThis === per ? 'Full · ' + fmt(per) + ' cans'
      : fmt(p.onThis) + ' cans' + ' <span style="color:#76807B">(' + p.fullLayers + ' full layer' + (p.fullLayers === 1 ? '' : 's') + (p.partLayer ? ' + ' + p.partLayer : '') + ')</span>';
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:#D4D5CF"></span><span>' + esc(p.kind.label) + '</span></div>' +
      '<div class="tk-snap-tank">Packaging Inventory · On Hand</div>' +
      '<div class="tk-snap-row"><span>In inventory</span><span class="tk-num">' + fmt(n) + (n === 1 ? ' can' : ' cans') + '</span></div>' +
      '<div class="tk-snap-row"><span>Full pallet</span><span class="tk-num">' + fmt(per) + ' <span style="color:#76807B">(' + p.kind.layers + ' × ' + PER_LAYER + ')</span></span></div>' +
      (p.pallets > 1 ? '<div class="tk-snap-row"><span>Pallets</span><span class="tk-num">' + p.palletNo + ' of ' + p.pallets + '</span></div>' : '') +
      '<div class="tk-snap-row"><span>This pallet</span><span class="tk-num">' + thisTxt + '</span></div>';
  }
  function fillSnapLids(p){
    const n = p.onHand, chutes = Math.ceil(n/LID_PER_SLEEVE), here = Math.ceil(p.onThis/LID_PER_SLEEVE);
    const thisTxt = !p.onThis ? 'Empty pallet' : p.onThis === LIDS_FULL ? 'Full · ' + fmt(LIDS_FULL) + ' lids' : fmt(p.onThis) + ' lids <span style="color:#76807B">(' + here + (here === 1 ? ' chute' : ' chutes') + ')</span>';
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:#B48A5A"></span><span>202 LOE Ends (Lids)</span></div>' +
      '<div class="tk-snap-tank">Packaging Inventory · On Hand</div>' +
      '<div class="tk-snap-row"><span>In inventory</span><span class="tk-num">' + fmt(n) + (n === 1 ? ' lid' : ' lids') + '</span></div>' +
      '<div class="tk-snap-row"><span>Chutes</span><span class="tk-num">' + fmt(chutes) + ' <span style="color:#76807B">(' + LID_PER_SLEEVE + ' per chute)</span></span></div>' +
      '<div class="tk-snap-row"><span>Full pallet</span><span class="tk-num">' + fmt(LIDS_FULL) + ' <span style="color:#76807B">(' + SLV_PER_LAYER*SLV_LAYERS + ' chutes)</span></span></div>' +
      (p.pallets > 1 ? '<div class="tk-snap-row"><span>Pallets</span><span class="tk-num">' + p.palletNo + ' of ' + p.pallets + '</span></div>' : '') +
      '<div class="tk-snap-row"><span>This pallet</span><span class="tk-num">' + thisTxt + '</span></div>';
  }
  function fillSnapLabels(p){
    const n = p.onHand, rolls = p.full + (p.part ? 1 : 0);
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:#7A6A58"></span><span>' + esc(p.name) + '</span></div>' +
      '<div class="tk-snap-tank">' + esc(p.shelf.label) + ' · Label Inventory · On Hand</div>' +
      '<div class="tk-snap-row"><span>In inventory</span><span class="tk-num">' + fmt(n) + (n === 1 ? ' label' : ' labels') + '</span></div>' +
      '<div class="tk-snap-row"><span>Rolls</span><span class="tk-num">' + (rolls ? p.full + ' full' + (p.part ? ' + 1 part (' + fmt(p.part) + ')' : '') : 'None') + '</span></div>' +
      '<div class="tk-snap-row"><span>Per roll</span><span class="tk-num">' + fmt(LBL_PER_ROLL) + '</span></div>';
  }
  function fillSnapPallet(p){
    if (p.isLabels) return fillSnapLabels(p);
    if (p.isLids) return fillSnapLids(p);
    if (p.isCans) return fillSnapCans(p);
    const n = p.onHand, word = c => c === 1 ? ' keg' : ' kegs';
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:#C8CECB"></span><span>' + esc(p.kind.label) + '</span></div>' +
      '<div class="tk-snap-tank">Packaging Inventory · On Hand</div>' +
      '<div class="tk-snap-row"><span>In inventory</span><span class="tk-num">' + n + word(n) + '</span></div>' +
      '<div class="tk-snap-row"><span>Pallets</span><span class="tk-num">' + (n ? p.pallets : 0) + ' <span style="color:#76807B">(' + p.kind.per + ' per pallet)</span></span></div>' +
      '<div class="tk-snap-row"><span>This pallet</span><span class="tk-num">' + (p.onThis ? p.onThis + ' of ' + p.kind.per : 'Empty') + '</span></div>';
  }
  function fillSnap(t){
    if (t.isPallet) return fillSnapPallet(t);
    if (t.live) return fillSnapLive(t);
    const d = SNAP[t.name], ph = PHASE[d.phase], done = d.phase === 'done', st = STAGE[ph.stage];
    const left = tasksLeft(d);
    const tasks = (done || !left.length)
      ? '<div class="tk-all-done"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A6DC8B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>All tasks completed</div>'
      : '<div class="tk-tasks-h"><span>Tasks left</span><span>' + left.length + '</span></div><div class="tk-tasks">' +
        left.map((k,i) => '<div class="tk-task' + (i===0?' next':'') + '"><span class="d">Day ' + k.day + '</span><span class="n">' + esc(k.name) + '</span></div>').join('') + '</div>';
    snapEl.innerHTML =
      '<div class="tk-snap-prod"><span class="tk-swatch" style="background:' + esc(t.color) + '"></span><span>' + esc(t.spec.product) + '</span></div>' +
      '<div class="tk-snap-tank">' + esc(t.name) + ' · ' + t.capacity + ' bbl unitank</div>' +
      '<div class="tk-snap-row"><span>Days in tank</span><span class="tk-num">' + ph.days + (ph.days === 1 ? ' day' : ' days') + '</span></div>' +
      '<div class="tk-snap-row"><span>Left in tank</span><span class="tk-num">' + t.volume.toFixed(2) + ' bbl</span></div>' +
      '<div class="tk-snap-row"><span>Status</span><span class="tk-snap-pill" style="background:' + st.bg + ';color:' + st.fg + '">' + esc(ph.stage) + '</span></div>' +
      tasks;
  }
  function showSnap(t){ snapTank = t; snapAt = { ...lastPointer }; fillSnap(t); snapEl.classList.add('show'); snapEl.setAttribute('aria-hidden','false'); positionSnap(); }
  function hideSnap(){ snapTank = null; snapAt = null; snapEl.classList.remove('show'); snapEl.setAttribute('aria-hidden','true'); }
  // Pops up right above the mouse pointer (Chad, 2026-10-04), at the spot where the pointer
  // was when it appeared, and stays there so you can move onto it and scroll the tasks.
  function positionSnap(){
    if (!snapTank || !snapAt) return;
    const w = viewerEl.clientWidth, h = viewerEl.clientHeight, sw = snapEl.offsetWidth, shh = snapEl.offsetHeight, gap = 16;
    const fitsAbove = snapAt.y - shh - gap >= 8, fitsBelow = snapAt.y + gap + shh <= h - 8;
    let x = Math.min(Math.max(snapAt.x - sw/2, 8), w - sw - 8), y;
    const mode = fitsAbove ? 'above' : fitsBelow ? 'below' : 'side';
    if (mode === 'above') y = snapAt.y - shh - gap;
    else if (mode === 'below') y = snapAt.y + gap;
    else {
      x = snapAt.x + 22 + sw <= w - 8 ? snapAt.x + 22 : snapAt.x - 22 - sw;
      y = Math.min(Math.max(snapAt.y - shh/2, 8), h - shh - 8);
    }
    snapEl.classList.toggle('below', mode === 'below');
    snapEl.classList.toggle('side', mode === 'side');
    snapEl.style.setProperty('--tip', Math.min(Math.max(snapAt.x - x, 20), sw - 20) + 'px');
    snapEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  function updateSnapHover(now){
    const t = (hovered && hovered.volume > 0.05 && (LIVE.size ? !!hovered.live : !!SNAP[hovered.name]) ? hovered : null) || hoveredPallet;
    if (t){
      if (hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
      if (snapTank !== t){
        if (!hoverSince || hoverSince.t !== t) hoverSince = { t, at: now };
        if (now - hoverSince.at >= 1500) showSnap(t);   // 1.5 s hover delay (Chad)
      }
    } else {
      hoverSince = 0;
      if (snapTank && !overSnap && !hideTimer) hideTimer = setTimeout(()=>{ hideTimer = null; if (!overSnap && hovered !== snapTank && hoveredPallet !== snapTank) hideSnap(); }, 250);
    }
  }
  const onSnapEnter = () => { overSnap = true; };
  const onSnapLeave = () => { overSnap = false; };
  const onSnapWheel = e => e.stopPropagation();
  snapEl.addEventListener('pointerenter', onSnapEnter);
  snapEl.addEventListener('pointerleave', onSnapLeave);
  snapEl.addEventListener('wheel', onSnapWheel);

  // ---------- Camera controls: left-drag turns, right-drag slides, scroll zooms ----------
  // (focusTank / flyTo — the Status section's zoom-in — are right after the controls.)
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-8, 4, -4);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 6; controls.maxDistance = 260;
  controls.maxPolarAngle = 1.48; controls.minPolarAngle = 0.15;
  controls.enablePan = true; controls.screenSpacePanning = true; controls.panSpeed = 0.8;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  // (top raised from 16 to 120 ft on 2026-10-05 so W A S D free roam can keep its look-at point up
  // where the camera is looking — see updateRoam)
  // (2026-10-26) the building + room around it to look at the outside walls
  const PAN_MIN = new THREE.Vector3(-BLD_D/2 - 30, 0.5, -BLD_W/2 - 30), PAN_MAX = new THREE.Vector3(BLD_D/2 + 30, 120, BLD_W/2 + 30);
  // ---------- Zoom to a tank (Chad, 2026-10-23): clicking a row in the Status section glides the
  // camera (about 1 s) to the front of that tank — the whole tank in view (lid to floor, ~85% of
  // the view's height since v1.42; v1.40 came in to the label and was "zooming too much"), label
  // readable, neighbours mostly out of frame. Distance follows the tank's size and the screen
  // shape, so 60 / 30 / 7 bbl tanks frame alike. If another tank stands between the camera and
  // the tank, it swings round (up to 50°, the label still faces it), else rises and looks down
  // over the tanks in front. Dragging, scrolling
  // or W A S D during the glide stops it where it is.
  let flight = null;
  const easeIO = k => (k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2);
  function flyTo(view, ms = 1000){
    if (!view) return;
    if (fp.active) exitFP();
    const p1 = Array.isArray(view.p) ? new THREE.Vector3().fromArray(view.p) : view.p.clone();
    const t1 = Array.isArray(view.t) ? new THREE.Vector3().fromArray(view.t) : view.t.clone();
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1, t1, start: performance.now(), ms: reduce ? 1 : ms };
  }
  function updateFlight(now){
    if (!flight) return;
    const k = Math.min(1, (now - flight.start)/flight.ms), e = easeIO(k);
    camera.position.lerpVectors(flight.p0, flight.p1, e);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    if (k >= 1) flight = null;
  }
  controls.addEventListener('start', ()=>{ flight = null; });   // the person took over
  function focusTank(name){
    const t = byName(name);
    if (!t) return null;
    if (fp.active) exitFP();
    const before = getView();
    select(t);
    const gx = t.group.position.x, gz = t.group.position.z, R = t.Rft, H = t.Hft;
    // v1.42 (Chad: "its zooming too much"): pull back so the WHOLE tank shows, lid to floor,
    // filling about 85% of the view's height (and never more than ~85% of its width), aimed
    // at its middle (the label sits just under centre). Label still readable.
    const vHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const hHalf = vHalf * camera.aspect;
    const aimY = H*0.5;
    const want = Math.max((H/0.86)/2/vHalf, R/0.85/hHalf, 8);   // from the tank's centre line
    const LOOK_DOWN = 0.12;                                       // slightly above, looking a touch down
    // Tanks between the camera and the one picked: the line is blocked where it passes through
    // another tank's footprint below that tank's top (+1 ft).
    const blockersOn = (ang, dist) => {
      const dx = Math.sin(ang), dz = Math.cos(ang), out = [];
      for (const o of tanks){
        if (o === t) continue;
        const cx = o.group.position.x - gx, cz = o.group.position.z - gz;
        const along = cx*dx + cz*dz; if (along <= R || along >= dist + o.Rft) continue;
        // in the way = its footprint reaches into the middle half of the view at that distance
        const off = Math.abs(cx*dz - cz*dx), rr = o.Rft + 0.5 + Math.max(0, dist - along)*hHalf*0.5;
        if (off < rr) out.push({ s: Math.max(R, along - o.Rft), top: o.Hft + 1 });
      }
      return out;
    };
    const lineClear = (ang, dist, camY) => blockersOn(ang, dist).every(b => aimY + (camY - aimY)*b.s/dist >= b.top);
    // 1) straight on, or swung round the tank up to 50° (the label still faces the camera)
    let ang = null, camY = aimY + want*LOOK_DOWN;
    for (const deg of [0, 15, -15, 30, -30, 40, -40, 50, -50]){
      const a = THREE.MathUtils.degToRad(deg);
      if (lineClear(a, want, camY)){ ang = a; break; }
    }
    // 2) still blocked: stay straight on and rise to look down over the tanks in front
    if (ang === null){
      ang = 0;
      for (const b of blockersOn(0, want)) camY = Math.max(camY, aimY + (b.top - aimY)*want/b.s);
    }
    const dist = want;
    const dx = Math.sin(ang), dz = Math.cos(ang);
    const target = new THREE.Vector3(gx, aimY, gz);
    const pos = new THREE.Vector3(gx + dx*dist, camY, gz + dz*dist);
    controls.minDistance = Math.min(6, pos.distanceTo(target) - 0.1);
    flyTo({ p: pos, t: target });
    return before;
  }
  controls.addEventListener('change', ()=>{
    const tg = controls.target, before = tg.clone(); tg.clamp(PAN_MIN, PAN_MAX);
    if (!tg.equals(before)) camera.position.add(tg.clone().sub(before));
  });

  // ---------- Hover + click ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hovered = null, hoveredPallet = null, downAt = null, lastHitGuy = false;
  function hitTest(e){
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables, false).find(h => h.object.visible && (!h.object.userData.guy || guy.visible));
    lastHitGuy = !!(hit && hit.object.userData.guy);
    hoveredPallet = hit ? (hit.object.userData.pallet || null) : null;
    return hit ? (hit.object.userData.tank || null) : null;
  }
  const onMove = e => { if (fp.active){ canvas.style.cursor = 'none'; return; } const vr = canvas.getBoundingClientRect(); lastPointer = { x: e.clientX - vr.left, y: e.clientY - vr.top }; hovered = hitTest(e); canvas.style.cursor = (hovered || lastHitGuy || hoveredPallet) ? 'pointer' : 'grab'; };
  const onLeave = () => { hovered = null; hoveredPallet = null; };
  const onDown = e => { downAt = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!downAt) return; const moved = Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1]); downAt = null;
    if (fp.active){ if (moved <= 6) fpClick(); return; }
    if (moved > 6) return;
    const t = hitTest(e);
    if (lastHitGuy){ const vr = canvas.getBoundingClientRect(); showGuyCard(e.clientX - vr.left, e.clientY - vr.top); return; }
    hideGuyCard(); select(t);
  };
  const onKey = e => { if (e.key === 'Escape') select(null); };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('keydown', onKey);

  // ---------- The guy (Chad, 2026-10-05): a video-game style character built to match the
  // photo Chad shared — messy wavy bleached-blond hair with darker roots on the sides, dark
  // brows, stubble + thin mustache, black hoop earring in his left ear, red leopard-print
  // shirt with an open collar, thin gold chain. Lower half not in the photo: dark jeans +
  // white sneakers. Real height ≈ 5'10". He wanders and looks at random tanks. Click him →
  // "Take control" → first person: mouse looks, W A S D walks, Esc exits.
  const EYE_H = 5.45;   // he is ≈ 5'10"
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  function leopardTex(){
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.fillStyle = '#9b2214'; g.fillRect(0,0,N,N);
    let seed = 5; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i=0;i<70;i++){
      const x = rnd()*N, y = rnd()*N, r = 7 + rnd()*9;
      for (const [dx,dy] of [[0,0],[N,0],[-N,0],[0,N],[0,-N]]){
        g.fillStyle = '#c4452c'; g.beginPath(); g.ellipse(x+dx, y+dy, r*0.75, r*0.6, rnd()*3, 0, Math.PI*2); g.fill();   // lighter center
        g.strokeStyle = '#2a0805'; g.lineWidth = 3.2; g.setLineDash([r*0.9, r*0.45]);                                     // broken dark rosette ring
        g.beginPath(); g.ellipse(x+dx, y+dy, r, r*0.8, rnd()*3, 0, Math.PI*2); g.stroke(); g.setLineDash([]);
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.repeat.set(3.5, 3.5);
    return t;
  }
  function stubbleTex(){
    const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    let seed = 9; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    // u = around the head (0.5 = front), v = up. Stubble on the jaw/chin/cheeks + a thin mustache.
    for (let i=0;i<9000;i++){
      const u = rnd(), v = rnd();
      const du = Math.abs(u - 0.5);
      const jaw = v < 0.42 && v > 0.12 && du < 0.27 && !(v > 0.25 && v < 0.33 && du < 0.06);   // leave the lips clear
      const stache = v > 0.33 && v < 0.37 && du < 0.075;
      if (!jaw && !stache) continue;
      const a = stache ? 0.55 : 0.32 * Math.min(1, (0.27 - du)*12) * Math.min(1, (0.42 - v)*14);
      g.fillStyle = 'rgba(52,34,22,' + a.toFixed(3) + ')'; g.fillRect(u*W, (1-v)*H, 1.4, 1.4);
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  const skinMat  = new THREE.MeshStandardMaterial({ color: lin(0xd9a582), roughness: 0.72 });
  const shirtMat = new THREE.MeshStandardMaterial({ map: leopardTex(), roughness: 0.55, metalness: 0.05 });   // satin-ish shirt
  const jeansMat = new THREE.MeshStandardMaterial({ color: lin(0x23262c), roughness: 0.9 });
  const shoeMat  = new THREE.MeshStandardMaterial({ color: lin(0xf1f1ee), roughness: 0.6 });
  const soleMat  = new THREE.MeshStandardMaterial({ color: lin(0x3a3a3a), roughness: 0.8 });
  const browMat  = new THREE.MeshStandardMaterial({ color: lin(0x2b1d14), roughness: 0.9 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: lin(0xf2eee8), roughness: 0.3 });
  const irisMat  = new THREE.MeshStandardMaterial({ color: lin(0x3b2618), roughness: 0.3 });
  const lipMat   = new THREE.MeshStandardMaterial({ color: lin(0xc07d66), roughness: 0.6 });
  const goldMat  = new THREE.MeshStandardMaterial({ color: lin(0xd9b45a), metalness: 1, roughness: 0.25, envMap: steelEnv });
  const hoopMat  = new THREE.MeshStandardMaterial({ color: lin(0x151515), metalness: 0.6, roughness: 0.35 });
  const stubMat  = new THREE.MeshStandardMaterial({ map: stubbleTex(), transparent: true, roughness: 0.9, depthWrite: false });
  const guyMeshes = [];
  const part = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x||0, y||0, z||0); parent.add(m); m.userData.guy = true; guyMeshes.push(m); return m; };
  const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const guy = new THREE.Group(); scene.add(guy);
  const body = new THREE.Group(); guy.add(body);        // bobs while walking
  // legs: hip → thigh → knee → shin → sneaker
  const legs = [];
  for (const sx of [-1, 1]){
    const hip = pivot(body, sx*0.29, 2.95, 0);
    part(new THREE.CylinderGeometry(0.24, 0.2, 1.45, 14), jeansMat, hip, 0, -0.72, 0);
    const knee = pivot(hip, 0, -1.45, 0);
    part(new THREE.CylinderGeometry(0.19, 0.16, 1.3, 14), jeansMat, knee, 0, -0.65, 0);
    const shoe = new THREE.Group(); shoe.position.set(0, -1.38, 0.12); knee.add(shoe);
    part(new THREE.BoxGeometry(0.36, 0.2, 0.82), shoeMat, shoe, 0, 0.02, 0);
    part(new THREE.SphereGeometry(0.18, 12, 8), shoeMat, shoe, 0, 0.04, 0.38).scale.set(1, 0.6, 0.9);
    part(new THREE.BoxGeometry(0.38, 0.07, 0.9), soleMat, shoe, 0, -0.09, 0.02);
    legs.push({ hip, knee, sx });
  }
  // torso: leopard shirt, slightly tapered, flattened front-to-back
  const torso = part(new THREE.CylinderGeometry(0.66, 0.52, 2.05, 20), shirtMat, body, 0, 3.98, 0); torso.scale.z = 0.62;
  part(new THREE.SphereGeometry(0.66, 20, 10, 0, Math.PI*2, 0, Math.PI/2), shirtMat, body, 0, 5.0, 0).scale.set(1, 0.32, 0.62);   // shoulders
  part(new THREE.CylinderGeometry(0.53, 0.53, 0.25, 18), jeansMat, body, 0, 2.95, 0).scale.z = 0.66;                                  // waist
  // open collar: skin V on the chest, two collar points, gold chain
  const vneck = part(new THREE.CircleGeometry(0.34, 3), skinMat, body, 0, 4.82, 0.405); vneck.rotation.z = -Math.PI/2; vneck.scale.set(1.1, 0.62, 1);
  for (const sx of [-1, 1]){
    const flap = part(new THREE.BoxGeometry(0.3, 0.42, 0.04), shirtMat, body, sx*0.2, 5.0, 0.41);
    flap.rotation.set(-0.3, 0, sx*0.6);
  }
  const chain = part(new THREE.TorusGeometry(0.24, 0.012, 6, 32, Math.PI), goldMat, body, 0, 4.98, 0.33);
  chain.rotation.set(-1.2, 0, Math.PI);
  part(new THREE.SphereGeometry(0.03, 8, 6), goldMat, body, 0, 4.76, 0.41);                                                           // little pendant
  // arms: long leopard sleeves, skin hands
  const arms = [];
  for (const sx of [-1, 1]){
    const sh = pivot(body, sx*0.72, 4.86, 0);
    part(new THREE.CylinderGeometry(0.18, 0.16, 1.2, 12), shirtMat, sh, 0, -0.6, 0);
    const el = pivot(sh, 0, -1.2, 0);
    part(new THREE.CylinderGeometry(0.155, 0.13, 1.05, 12), shirtMat, el, 0, -0.52, 0);
    part(new THREE.SphereGeometry(0.15, 12, 10), skinMat, el, 0, -1.15, 0).scale.set(0.8, 1.15, 0.6);
    sh.rotation.z = sx*0.08;
    arms.push({ sh, el, sx });
  }
  // neck + head
  part(new THREE.CylinderGeometry(0.19, 0.21, 0.42, 14), skinMat, body, 0, 5.22, 0.02);
  const head = pivot(body, 0, 5.62, 0.04);
  part(new THREE.SphereGeometry(0.42, 28, 22), skinMat, head, 0, 0, 0).scale.set(0.92, 1.12, 0.98);
  part(new THREE.SphereGeometry(0.43, 28, 22), stubMat, head, 0, 0, 0).scale.set(0.93, 1.13, 0.99);   // stubble + mustache layer
  for (const sx of [-1, 1]){
    part(new THREE.SphereGeometry(0.075, 12, 10), eyeWhite, head, sx*0.15, 0.07, 0.375).scale.set(1.2, 0.6, 0.6);
    part(new THREE.SphereGeometry(0.04, 10, 8), irisMat, head, sx*0.15, 0.065, 0.413).scale.set(1, 0.85, 0.45);
    const brow = part(new THREE.BoxGeometry(0.2, 0.05, 0.05), browMat, head, sx*0.155, 0.17, 0.405); brow.rotation.z = -sx*0.12;   // dark, slightly lowered
    part(new THREE.SphereGeometry(0.09, 12, 10), skinMat, head, sx*0.39, 0.02, 0.0).scale.set(0.45, 1, 0.7);                       // ears
  }
  part(new THREE.ConeGeometry(0.07, 0.24, 10), skinMat, head, 0, -0.02, 0.44).rotation.x = Math.PI*0.5 + 0.35;                       // nose
  part(new THREE.SphereGeometry(0.075, 12, 8), skinMat, head, 0, -0.1, 0.45).scale.set(1.15, 0.65, 0.65);                             // nose tip
  part(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.022, 0.15, 4, 8) : new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), lipMat, head, 0, -0.25, 0.405).rotation.z = Math.PI/2;
  const hoop = part(new THREE.TorusGeometry(0.1, 0.009, 8, 28), hoopMat, head, 0.405, -0.13, 0.0);                                    // his left ear
  hoop.rotation.y = Math.PI/2;
  // hair: messy, wavy, bleached blond, swept over the forehead to one side; darker roots on the sides
  {
    const blond = new THREE.MeshStandardMaterial({ color: lin(0xe3b766), roughness: 0.7 });
    const roots = new THREE.MeshStandardMaterial({ color: lin(0x3a2b20), roughness: 0.85 });
    // base cap so no scalp shows, and a darker band low on the sides/back (the roots)
    part(new THREE.SphereGeometry(0.455, 28, 14, 0, Math.PI*2, 0, 1.15), blond, head, 0, 0.05, -0.01).scale.set(0.95, 1.1, 1.0);
    const band = part(new THREE.SphereGeometry(0.445, 28, 8, Math.PI/2 + 0.75, Math.PI*2 - 1.5, 0.95, 0.6), roots, head, 0, 0.02, -0.01);
    band.scale.set(0.95, 1.1, 1.0);
    // wavy clumps lying along the head, flowing down/back, plus a swoop of fringe over the forehead
    const HN = 120, clump = new THREE.SphereGeometry(1, 10, 8);
    const hair = new THREE.InstancedMesh(clump, new THREE.MeshStandardMaterial({ roughness: 0.68 }), HN);
    hair.userData.guy = true; guyMeshes.push(hair); head.add(hair);
    const m4 = new THREE.Matrix4(), n = new THREE.Vector3(), tg = new THREE.Vector3(), bt = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
    let seed = 3; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
    for (let i=0;i<HN;i++){
      const fringe = i >= 92;
      // th: angle around the head (0 = face), ph: from the top down
      const th = fringe ? -0.75 + rnd()*1.35 : rnd()*Math.PI*2;
      const ph = fringe ? 0.55 + rnd()*0.42 : Math.acos(1 - rnd()*0.62);
      const rad = 0.475 + rnd()*0.03;
      n.set(Math.sin(th)*Math.sin(ph), Math.cos(ph), Math.cos(th)*Math.sin(ph)).normalize();
      pos.set(n.x*rad*0.95, n.y*rad*1.1 + 0.05, n.z*rad);
      // flow direction: down the head; the fringe sweeps across to his right
      tg.set(Math.sin(th)*Math.cos(ph), -Math.sin(ph), Math.cos(th)*Math.cos(ph)).normalize();
      if (fringe) tg.add(new THREE.Vector3(-0.9, -0.2, 0)).normalize();
      tg.applyAxisAngle(n, (rnd() - 0.5)*0.9);                          // wavy, messy
      bt.crossVectors(tg, n).normalize(); tg.crossVectors(n, bt).normalize();
      const len = fringe ? 0.16 + rnd()*0.07 : 0.15 + rnd()*0.1, wid = 0.075 + rnd()*0.04, thk = 0.045 + rnd()*0.03;
      m4.makeBasis(tg.clone().multiplyScalar(len), n.clone().multiplyScalar(thk), bt.clone().multiplyScalar(wid));
      m4.setPosition(pos);
      hair.setMatrixAt(i, m4);
      hair.setColorAt(i, c.setHSL(0.105 + rnd()*0.02, 0.55 + rnd()*0.12, 0.6 + rnd()*0.13).convertSRGBToLinear());
    }
  }
  // soft shadow under him
  const guyShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  guyShadow.rotation.x = -Math.PI/2; guyShadow.position.y = 0.03; guy.add(guyShadow);
  guyMeshes.forEach(m => pickables.push(m));

  // ---------- Walking around on his own ----------
  const PERSON_R = 0.9;
  const blockers = tanks.map(t => ({ x: t.group.position.x, z: t.group.position.z, r: t.Rft*1.12 + PERSON_R }))
    .concat(kegStacks.map(st => ({ x: st.x, z: st.z, r: Math.hypot(PAL_X/2 + 0.2, PAL_Z/2) + PERSON_R })))    // keg pallets too
    .concat(canPallets.map(p => ({ x: p.x, z: p.z, r: Math.hypot(CPAL_X/2, CPAL_Z/2) + PERSON_R })))          // can pallets
    .concat(lidPallets.map(p => ({ x: p.x, z: p.z, r: Math.hypot(LPAL_X/2, LPAL_Z/2) + PERSON_R })))          // lid pallets
    .concat(labels ? Array.from({ length: Math.ceil(RACK_W/2.5) + 1 }, (_, i) => ({ x: rack.x - RACK_W/2 + i*(RACK_W/Math.ceil(RACK_W/2.5)), z: rack.z, r: RACK_D/2 + 0.4 + PERSON_R })) : []);   // label rack
  function freeSpot(x, z){ return blockers.every(b => Math.hypot(x - b.x, z - b.z) > b.r); }
  function pushOut(p){        // never inside a tank (or its legs)
    for (const b of blockers){ const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz); if (d < b.r){ const k = b.r/(d || 1e-3); p.x = b.x + dx*k; p.z = b.z + dz*k; } }
    p.x = Math.max(-IN_Z + PERSON_R, Math.min(IN_Z - PERSON_R, p.x)); p.z = Math.max(-IN_X + PERSON_R, Math.min(IN_X - PERSON_R, p.z));   // stays inside the brick walls (length = x, width = z)
    if (p.x < ROOMS.x1 + PERSON_R && p.z > ROOMS.z0 - PERSON_R) p.z = ROOMS.z0 - PERSON_R;   // not through the office/lab/bathroom/storage walls
  }
  const ai = { mode: 'walk', target: null, tank: null, wait: 0, look: 0 };
  function pickTank(){
    const t = tanks[(Math.random()*tanks.length)|0];
    // stand in front-ish of the tank, a couple of feet back, at a random angle
    for (let k=0;k<12;k++){
      const a = (Math.random() - 0.5)*Math.PI*1.4, d = t.Rft*1.12 + 3 + Math.random()*2.5;
      const x = t.group.position.x + Math.sin(a)*d, z = t.group.position.z + Math.cos(a)*d;
      if (freeSpot(x, z)){ ai.tank = t; ai.target = { x, z }; ai.mode = 'walk'; return; }
    }
    ai.tank = t; ai.target = { x: t.group.position.x, z: t.group.position.z + t.Rft + 4 }; ai.mode = 'walk';
  }
  { const s = { x: 10, z: 10 }; pushOut(s); guy.position.set(s.x, 0, s.z); }   // in the aisle in front of the tanks
  pickTank();
  let walkPhase = 0, guyYaw = 0;
  function poseGuy(speed, dt, lookUp){
    walkPhase += speed*dt*1.15;
    const k = Math.min(1, speed/3.2), sw = Math.sin(walkPhase);
    for (const L of legs){ const s = L.sx < 0 ? sw : -sw; L.hip.rotation.x = s*0.55*k; L.knee.rotation.x = Math.max(0, -Math.cos(walkPhase + (L.sx < 0 ? 0 : Math.PI)))*0.75*k; }
    for (const A of arms){ const s = A.sx < 0 ? -sw : sw; A.sh.rotation.x = s*0.45*k; A.el.rotation.x = -0.25 - 0.2*k; }
    body.position.y = Math.abs(Math.cos(walkPhase))*0.09*k;
    head.rotation.x += ((-lookUp) - head.rotation.x)*Math.min(1, dt*3);
  }
  function turnTo(yaw, dt){
    let d = yaw - guyYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    guyYaw += d*Math.min(1, dt*5); guy.rotation.y = guyYaw;
    return Math.abs(d);
  }
  function updateGuyAI(dt, tm){
    const p = guy.position;
    if (ai.mode === 'walk'){
      const dx = ai.target.x - p.x, dz = ai.target.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.4){ ai.mode = 'look'; ai.wait = 3 + Math.random()*4; poseGuy(0, dt, 0); return; }
      // steer toward the spot, sliding around any tank in the way
      let vx = dx/d, vz = dz/d;
      for (const b of blockers){
        const ox = p.x - b.x, oz = p.z - b.z, od = Math.hypot(ox, oz), near = b.r + 2.5;
        if (od < near){ const w = (near - od)/near; vx += (ox/od)*w*1.6 + (-oz/od)*w*0.8; vz += (oz/od)*w*1.6 + (ox/od)*w*0.8; }
      }
      const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      const speed = 3.2;                                            // ≈ 2.2 mph stroll
      turnTo(Math.atan2(vx, vz), dt);
      p.x += Math.sin(guyYaw)*speed*dt; p.z += Math.cos(guyYaw)*speed*dt; pushOut(p);
      poseGuy(speed, dt, 0);
    } else {
      const t = ai.tank;
      turnTo(Math.atan2(t.group.position.x - p.x, t.group.position.z - p.z), dt);
      ai.wait -= dt;
      // looks up the tank and slowly back down
      const look = 0.15 + 0.35*(0.5 + 0.5*Math.sin(tm*0.7));
      poseGuy(0, dt, look);
      walkPhase = 0;
      if (ai.wait <= 0) pickTank();
    }
  }

  // ---------- Click him → "Take control" → first person ----------
  // the click card + first-person HUD are made here and live inside the 3D view box
  const guyCard = document.createElement('div'); guyCard.className = 'tk-guy-card'; guyCard.hidden = true;
  guyCard.innerHTML = '<div class="gh"><span>Walk around as him</span><button class="tk-x" type="button" aria-label="Close">✕</button></div>' +
    '<p>First person view. Mouse looks around, W A S D walks, left Shift runs, Space jumps. Aim the dot at a tank and click to see it. Press Esc to exit.</p>' +
    '<button class="take" type="button">Take control</button>';
  const fpHud = document.createElement('div'); fpHud.className = 'tk-fp-hud'; fpHud.hidden = true;
  const FP_NOTE = 'W A S D walk · Shift run · Space jump · mouse look · click a tank · <b>Esc</b> to exit';
  const FP_NOTE_PAUSED = 'Mouse free — use the tank card · click the view to look around again · <b>Esc</b> to exit';
  fpHud.innerHTML = '<div class="xh"></div><div class="note">' + FP_NOTE + '</div>';
  viewerEl.appendChild(guyCard); viewerEl.appendChild(fpHud);
  const fp = { active: false, yaw: 0, pitch: 0, keys: {}, saved: null, locked: false, dragging: false, walk: 0, run: false, y: 0, vy: 0, paused: false, resumeClick: false };
  // Clicking a tank as him (Chad, 2026-10-05: "i also want to be able to click on tanks as the
  // person"): aim the center dot at a tank and click → its details card opens, and the mouse is
  // let go so the card (and See Batch Details) can be used. You stay in first person (W A S D
  // still walks); click the 3D view again to go back to looking around, Esc leaves him.
  function fpClick(){
    if (fp.resumeClick){ fp.resumeClick = false; return; }
    if (fp.paused) return;
    mouse.set(0, 0); ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables, false).find(h => h.object.visible && !h.object.userData.guy);
    const t = hit ? (hit.object.userData.tank || null) : null;
    if (!t) return;
    select(t);
    fp.paused = true; fp.dragging = false;
    const note = fpHud.querySelector('.note'); note.innerHTML = FP_NOTE_PAUSED;
    note.style.top = 'auto'; note.style.bottom = '48px';   // out from under the tank card
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
  }
  function resumeFP(){
    fp.paused = false;
    const note = fpHud.querySelector('.note'); note.innerHTML = FP_NOTE; note.style.top = ''; note.style.bottom = '';
  }
  function showGuyCard(x, y){
    const w = viewerEl.clientWidth, cw = 230;
    guyCard.style.transform = 'translate(' + Math.min(Math.max(x - cw/2, 8), w - cw - 8) + 'px,' + Math.max(8, y - 150) + 'px)';
    guyCard.hidden = false;
  }
  function hideGuyCard(){ guyCard.hidden = true; }
  function enterFP(){
    hideGuyCard(); select(null); hideSnap(); hovered = null; hoveredPallet = null;
    fp.active = true; fp.saved = { pos: camera.position.clone(), target: controls.target.clone(), near: camera.near };
    fp.yaw = guyYaw + Math.PI; fp.pitch = 0;       // camera looks down -z; his yaw faces +z
    controls.enabled = false; guy.visible = false;
    camera.near = 0.1; camera.updateProjectionMatrix();
    camera.position.set(guy.position.x, EYE_H, guy.position.z);
    fpHud.hidden = false; canvas.focus();
    try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(()=>{}); } catch { /* drag to look instead */ }
  }
  function exitFP(){
    if (!fp.active) return;
    fp.active = false; fp.keys = {}; fp.run = false; fp.y = 0; fp.vy = 0; fpHud.hidden = true;
    fp.resumeClick = false; resumeFP();
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    // he stays where you left him, facing the way you were looking
    guy.position.set(camera.position.x, 0, camera.position.z); guyYaw = fp.yaw - Math.PI; guy.rotation.y = guyYaw; guy.visible = true;
    camera.near = fp.saved.near; camera.updateProjectionMatrix();
    camera.position.copy(fp.saved.pos); controls.target.copy(fp.saved.target); controls.enabled = true;
    pickTank();
  }
  guyCard.querySelector('.take').addEventListener('click', enterFP);
  guyCard.querySelector('.tk-x').addEventListener('click', hideGuyCard);
  const onLockChange = ()=>{
    fp.locked = document.pointerLockElement === canvas;
    if (fp.locked && fp.paused) resumeFP();          // clicked back into the view after using a tank card
    else if (!fp.locked && fp.active && !fp.paused) exitFP();   // browser releases the mouse on Esc → back out of him
  };
  document.addEventListener('pointerlockchange', onLockChange);
  const onFpKeyDown = e=>{
    if (!fp.active) return;
    if (e.key === 'Escape'){ exitFP(); e.preventDefault(); return; }
    if (e.code === 'ShiftLeft'){ fp.run = true; e.preventDefault(); return; }                 // left Shift = run (Chad)
    if (e.code === 'Space'){ if (fp.y <= 0 && !e.repeat) fp.vy = 10; e.preventDefault(); return; }   // Space = jump (Chad)
    const k = e.key.toLowerCase(); if ('wasd'.includes(k) && k.length === 1){ fp.keys[k] = true; e.preventDefault(); }
  };
  const onFpKeyUp = e=>{ if (e.code === 'ShiftLeft') fp.run = false; const k = e.key.toLowerCase(); if (k.length === 1) fp.keys[k] = false; };
  const onFpBlur = ()=>{ fp.keys = {}; fp.run = false; };
  window.addEventListener('keydown', onFpKeyDown);
  window.addEventListener('keyup', onFpKeyUp);
  window.addEventListener('blur', onFpBlur);
  // mouse look: with the pointer locked, just move the mouse; if the browser won't lock it, hold a button and drag
  const onFpDown = ()=>{ if (fp.active){ if (fp.paused){ fp.resumeClick = true; setTimeout(()=>{ if (fp.paused && !fp.locked) resumeFP(); }, 400); /* no mouse lock from the browser → drag to look */ } fp.dragging = true; if (!fp.locked && canvas.requestPointerLock){ try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(()=>{}); } catch { /* browser said no: drag to look instead */ } } } };
  const onFpUp = ()=>{ fp.dragging = false; };
  const onFpLook = e=>{
    if (!fp.active || fp.paused || !(fp.locked || fp.dragging)) return;
    fp.yaw -= e.movementX*0.0022; fp.pitch -= e.movementY*0.0022;
    fp.pitch = Math.max(-1.45, Math.min(1.45, fp.pitch));
  };
  canvas.addEventListener('mousedown', onFpDown);
  window.addEventListener('mouseup', onFpUp);
  window.addEventListener('mousemove', onFpLook);
  function disposeGuy(){
    if (fp.active && document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    document.removeEventListener('pointerlockchange', onLockChange);
    window.removeEventListener('keydown', onFpKeyDown); window.removeEventListener('keyup', onFpKeyUp); window.removeEventListener('blur', onFpBlur);
    canvas.removeEventListener('mousedown', onFpDown); window.removeEventListener('mouseup', onFpUp); window.removeEventListener('mousemove', onFpLook);
    guyCard.remove(); fpHud.remove();
  }
  function updateFP(dt){
    const f = (fp.keys.w ? 1 : 0) - (fp.keys.s ? 1 : 0), r = (fp.keys.d ? 1 : 0) - (fp.keys.a ? 1 : 0);
    const p = { x: camera.position.x, z: camera.position.z };
    if (f || r){
      const speed = fp.run ? 12 : 5.5, len = Math.hypot(f, r);     // walk ≈ 3.7 mph, run ≈ 8 mph
      // forward = where you're looking (flat on the floor)
      const fx = -Math.sin(fp.yaw), fz = -Math.cos(fp.yaw), rx = Math.cos(fp.yaw), rz = -Math.sin(fp.yaw);
      p.x += (fx*f + rx*r)/len*speed*dt; p.z += (fz*f + rz*r)/len*speed*dt;
      pushOut(p); fp.walk += dt*speed*1.15;
    }
    // jump: up and back down with gravity (about a 1.5 ft hop)
    if (fp.y > 0 || fp.vy > 0){ fp.vy -= 32*dt; fp.y += fp.vy*dt; if (fp.y <= 0){ fp.y = 0; fp.vy = 0; } }
    const bob = (f || r) && fp.y === 0 ? Math.abs(Math.sin(fp.walk))*(fp.run ? 0.1 : 0.06) : 0;
    camera.position.set(p.x, EYE_H + fp.y + bob, p.z);
    camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
  }
  // ---------- Free roam with the keyboard (Chad, 2026-10-05): W A S D slides the view
  // around the cellar when you're NOT in first person (mouse controls still work).
  // W/S = fly forward/back the way the camera is looking (look down at the tanks and W takes
  // you down in among them), A/D = slide left/right.
  // Hold Shift to go faster. Ignored while typing in a box on the page.
  const roam = { keys: {}, fast: false };
  const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  const onRoamKeyDown = e=>{
    if (fp.active || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Shift'){ roam.fast = true; return; }
    const k = e.key.toLowerCase(); if (k.length === 1 && 'wasd'.includes(k)){ roam.keys[k] = true; e.preventDefault(); }
  };
  const onRoamKeyUp = e=>{ if (e.key === 'Shift') roam.fast = false; const k = e.key.toLowerCase(); if (k.length === 1) roam.keys[k] = false; };
  const onRoamBlur = ()=>{ roam.keys = {}; roam.fast = false; };
  window.addEventListener('keydown', onRoamKeyDown);
  window.addEventListener('keyup', onRoamKeyUp);
  window.addEventListener('blur', onRoamBlur);
  const roamFwd = new THREE.Vector3(), roamMove = new THREE.Vector3(), ROAM_REACH = 25, ROAM_FLOOR = 3;
  function updateRoam(dt){
    if (fp.active){ roam.keys = {}; return; }
    const f = (roam.keys.w ? 1 : 0) - (roam.keys.s ? 1 : 0), r = (roam.keys.d ? 1 : 0) - (roam.keys.a ? 1 : 0);
    if (!f && !r) return;
    flight = null;   // W A S D during a zoom-in glide stops it where it is
    camera.getWorldDirection(roamFwd);
    // The mouse turns the view around a look-at point; zoomed out, that point can be 100+ ft
    // ahead and it stops at the edge of the floor long before the camera gets in among the
    // tanks (Chad: "why does it stop, i need to be able to go into the middle of these tanks").
    // So while roaming, keep the look-at point just ahead of the camera on the same line of
    // sight — the view doesn't change, but the camera itself now travels into the cellar.
    if (camera.position.distanceTo(controls.target) > ROAM_REACH) controls.target.copy(camera.position).addScaledVector(roamFwd, ROAM_REACH);
    // speed grows with how high the camera is (down low among the tanks = slow and precise)
    const speed = Math.max(8, camera.position.y*0.5) * (roam.fast ? 2.2 : 1);
    const side = Math.hypot(roamFwd.x, roamFwd.z) > 1e-4 ? [-roamFwd.z, roamFwd.x] : [1, 0];
    const sl = Math.hypot(side[0], side[1]);
    roamMove.set(roamFwd.x*f + side[0]/sl*r, roamFwd.y*f, roamFwd.z*f + side[1]/sl*r);
    if (roamMove.lengthSq() < 1e-8) return;
    roamMove.setLength(speed*dt);
    // never through the floor or up into the clouds
    const ny = Math.min(120, Math.max(ROAM_FLOOR, camera.position.y + roamMove.y));
    roamMove.y = ny - camera.position.y;
    camera.position.add(roamMove); controls.target.add(roamMove);
    const tg = controls.target, before = tg.clone(); tg.clamp(PAN_MIN, PAN_MAX);
    if (!tg.equals(before)) camera.position.add(tg.clone().sub(before));
  }
  function disposeRoam(){
    window.removeEventListener('keydown', onRoamKeyDown); window.removeEventListener('keyup', onRoamKeyUp); window.removeEventListener('blur', onRoamBlur);
  }

  function updateGuy(dt, tm){
    if (fp.active) updateFP(dt);
    else if (!reduce) updateGuyAI(dt, tm);
  }


  // ---------- Resize + loop ----------
  function resize(){
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w/h;
    camera.fov = w < 600 ? 50 : 36; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  if (canvas.clientWidth < 600) camera.position.sub(controls.target).setLength(190).add(controls.target);

  const clock = new THREE.Clock();
  let raf = 0;
  tanks.forEach(t => { if (t.foam.visible || t.floatHops.visible) animateFerment(t, 0.016, 0); });
  function frame(){
    const dt = Math.min(clock.getDelta(), 0.05), tm = clock.elapsedTime;
    for (const t of tanks){
      if ((t.foam.visible || t.floatHops.visible) && !reduce) animateFerment(t, dt, tm);
      t.hover += ((hovered === t ? 1 : 0) - t.hover) * Math.min(1, dt*10);
      t.shellMat.uniforms.uHover.value = t.hover;
      t.solidMat.emissiveIntensity = t.coneMat.emissiveIntensity = 0.10*t.hover + (selected === t ? 0.05 : 0);
      t.lineMat.opacity = 0.30 + 0.30*t.hover + (selected === t ? 0.12 : 0);
      if (t.winY !== t.winTarget){   // temp pill slides along the scale when the temp changes
        t.winY += (t.winTarget - t.winY)*Math.min(1, dt*4);
        if (Math.abs(t.winTarget - t.winY) < 1e-3) t.winY = t.winTarget;
        t.tempWin.position.y = t.winY;
      }
      updateCrashIcon(t, tm); updateWarnIcon(t, tm);
      if (t.carbBubbles.visible && !reduce) animateCarb(t, dt, tm);
    }
    ring.material.opacity += ((selected ? 0.6 : 0) - ring.material.opacity) * Math.min(1, dt*8);
    if (hoveredPallet){ const b = hoveredPallet.box; palletHi.position.set(b.x, b.y, b.z); palletHi.scale.set(b.w + 0.1, b.h + 0.06, b.d + 0.1); palletHi.visible = true; }
    palletHi.material.opacity += ((hoveredPallet ? 0.85 : 0) - palletHi.material.opacity) * Math.min(1, dt*10);
    if (palletHi.material.opacity < 0.01) palletHi.visible = false;
    updateSnapHover(performance.now());
    updateGuy(dt, tm);
    updateRoam(dt);
    updateFlight(performance.now());
    updateWalls(dt);
    if (!fp.active) controls.update();
    renderer.render(scene, camera);
    positionSnap();
    updateCountTags();
    raf = requestAnimationFrame(frame);
  }
  frame();

  function dispose(){
    disposed = true;
    hideSnap();   // a hover window left open would keep showing the old numbers
    cancelAnimationFrame(raf);
    if (hideTimer) clearTimeout(hideTimer);
    ro.disconnect();
    disposeGuy();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('keydown', onKey);
    snapEl.removeEventListener('pointerenter', onSnapEnter);
    snapEl.removeEventListener('pointerleave', onSnapLeave);
    snapEl.removeEventListener('wheel', onSnapWheel);
    controls.dispose();
    disposeRoam();
    countTags.forEach(t => t.el.remove());
    const seen = new Set();
    const free = x => { if (x && !seen.has(x)){ seen.add(x); x.dispose(); } };
    scene.traverse(o => {
      free(o.geometry);
      for (const m of [].concat(o.material || [])){ free(m.map); free(m); }
    });
    free(steelEnv); free(floorTex); free(shadowTex); free(palletTex); free(kegTex); free(brickRedTex); free(brickYellowTex); free(slatFrontTex); free(slatBackTex);
    renderer.dispose();
  }
  // getView/setView (2026-10-05): the app's preview controls rebuild the scene with changed
  // data — they keep the camera where it was.
  const getView = () => ({ p: camera.position.toArray(), t: controls.target.toArray() });
  const setView = v => { if (!v) return; flight = null; camera.position.fromArray(v.p); controls.target.fromArray(v.t); controls.update(); };
  return { dispose, select: t => select(t ? byName(t) : null), getView, setView, focus: focusTank, flyTo };
}
