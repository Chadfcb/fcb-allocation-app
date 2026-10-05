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
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createTankScene({ canvas, snapEl, onSelect, font, mono, live }){
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
  const FT_PER_PX = 0.135, CX = 490, CZ = 210;

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
  camera.position.set(12, 68, 113);

  scene.add(new THREE.HemisphereLight(0xdfeee6, 0x0b100e, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(30, 50, 35); scene.add(key);
  // Overhead cellar lights (Chad's idea, 2026-10-04): a row of lights up near the ceiling gives
  // the polished steel crisp shine/hotspots, all lit from the same place like a real cellar.
  for (const [x, z] of [[-30, -6], [0, -6], [30, -6], [-30, 14], [0, 14], [30, 14]]){
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
  function fillSnap(t){
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
    const t = hovered && hovered.volume > 0.05 && (LIVE.size ? !!hovered.live : !!SNAP[hovered.name]) ? hovered : null;
    if (t){
      if (hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
      if (snapTank !== t){
        if (!hoverSince || hoverSince.t !== t) hoverSince = { t, at: now };
        if (now - hoverSince.at >= 1500) showSnap(t);   // 1.5 s hover delay (Chad)
      }
    } else {
      hoverSince = 0;
      if (snapTank && !overSnap && !hideTimer) hideTimer = setTimeout(()=>{ hideTimer = null; if (!overSnap && hovered !== snapTank) hideSnap(); }, 250);
    }
  }
  const onSnapEnter = () => { overSnap = true; };
  const onSnapLeave = () => { overSnap = false; };
  const onSnapWheel = e => e.stopPropagation();
  snapEl.addEventListener('pointerenter', onSnapEnter);
  snapEl.addEventListener('pointerleave', onSnapLeave);
  snapEl.addEventListener('wheel', onSnapWheel);

  // ---------- Camera controls: left-drag turns, right-drag slides, scroll zooms ----------
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 4, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 6; controls.maxDistance = 260;
  controls.maxPolarAngle = 1.48; controls.minPolarAngle = 0.15;
  controls.enablePan = true; controls.screenSpacePanning = true; controls.panSpeed = 0.8;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const PAN_MIN = new THREE.Vector3(-75, 0.5, -48), PAN_MAX = new THREE.Vector3(75, 16, 48);
  controls.addEventListener('change', ()=>{
    const tg = controls.target, before = tg.clone(); tg.clamp(PAN_MIN, PAN_MAX);
    if (!tg.equals(before)) camera.position.add(tg.clone().sub(before));
  });

  // ---------- Hover + click ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let hovered = null, downAt = null, lastHitGuy = false;
  function hitTest(e){
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(pickables, false).find(h => h.object.visible && (!h.object.userData.guy || guy.visible));
    lastHitGuy = !!(hit && hit.object.userData.guy);
    return hit ? (hit.object.userData.tank || null) : null;
  }
  const onMove = e => { if (fp.active){ canvas.style.cursor = 'none'; return; } const vr = canvas.getBoundingClientRect(); lastPointer = { x: e.clientX - vr.left, y: e.clientY - vr.top }; hovered = hitTest(e); canvas.style.cursor = (hovered || lastHitGuy) ? 'pointer' : 'grab'; };
  const onLeave = () => { hovered = null; };
  const onDown = e => { downAt = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!downAt) return; const moved = Math.hypot(e.clientX-downAt[0], e.clientY-downAt[1]); downAt = null;
    if (moved > 6 || fp.active) return;
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
  const blockers = tanks.map(t => ({ x: t.group.position.x, z: t.group.position.z, r: t.Rft*1.12 + PERSON_R }));
  function freeSpot(x, z){ return blockers.every(b => Math.hypot(x - b.x, z - b.z) > b.r); }
  function pushOut(p){        // never inside a tank (or its legs)
    for (const b of blockers){ const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz); if (d < b.r){ const k = b.r/(d || 1e-3); p.x = b.x + dx*k; p.z = b.z + dz*k; } }
    p.x = Math.max(-75, Math.min(75, p.x)); p.z = Math.max(-48, Math.min(48, p.z));
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
  { const s = { x: 2, z: 8 }; pushOut(s); guy.position.set(s.x, 0, s.z); }
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
    '<p>First person view. Mouse looks around, W A S D walks, left Shift runs, Space jumps. Press Esc to exit.</p>' +
    '<button class="take" type="button">Take control</button>';
  const fpHud = document.createElement('div'); fpHud.className = 'tk-fp-hud'; fpHud.hidden = true;
  fpHud.innerHTML = '<div class="xh"></div><div class="note">W A S D walk · Shift run · Space jump · mouse look · <b>Esc</b> to exit</div>';
  viewerEl.appendChild(guyCard); viewerEl.appendChild(fpHud);
  const fp = { active: false, yaw: 0, pitch: 0, keys: {}, saved: null, locked: false, dragging: false, walk: 0, run: false, y: 0, vy: 0 };
  function showGuyCard(x, y){
    const w = viewerEl.clientWidth, cw = 230;
    guyCard.style.transform = 'translate(' + Math.min(Math.max(x - cw/2, 8), w - cw - 8) + 'px,' + Math.max(8, y - 150) + 'px)';
    guyCard.hidden = false;
  }
  function hideGuyCard(){ guyCard.hidden = true; }
  function enterFP(){
    hideGuyCard(); select(null); hideSnap(); hovered = null;
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
    if (!fp.locked && fp.active) exitFP();          // browser releases the mouse on Esc → back out of him
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
  const onFpDown = ()=>{ if (fp.active){ fp.dragging = true; if (!fp.locked && canvas.requestPointerLock){ try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(()=>{}); } catch { /* browser said no: drag to look instead */ } } } };
  const onFpUp = ()=>{ fp.dragging = false; };
  const onFpLook = e=>{
    if (!fp.active || !(fp.locked || fp.dragging)) return;
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
  if (canvas.clientWidth < 600) camera.position.sub(controls.target).setLength(230).add(controls.target);

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
    updateSnapHover(performance.now());
    updateGuy(dt, tm);
    if (!fp.active) controls.update();
    renderer.render(scene, camera);
    positionSnap();
    raf = requestAnimationFrame(frame);
  }
  frame();

  function dispose(){
    disposed = true;
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
    const seen = new Set();
    const free = x => { if (x && !seen.has(x)){ seen.add(x); x.dispose(); } };
    scene.traverse(o => {
      free(o.geometry);
      for (const m of [].concat(o.material || [])){ free(m.map); free(m); }
    });
    free(steelEnv); free(floorTex); free(shadowTex);
    renderer.dispose();
  }
  return { dispose, select: t => select(t ? byName(t) : null) };
}
