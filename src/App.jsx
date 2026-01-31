import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDM9GK7_gnd0GaVbxwK9xnwl0qk75MnFXw",
  authDomain: "playmobil-2d74d.firebaseapp.com",
  projectId: "playmobil-2d74d",
  storageBucket: "playmobil-2d74d.firebasestorage.app",
  messagingSenderId: "85202851148",
  appId: "1:85202851148:web:bf8eba63238c06c7b4ebe9",
  measurementId: "G-MX2B76PCD6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'sandeco-ball-pro-v1';

// --- CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 18; 
const HITBOX_RELAX = 85; // Área amplia para "agarrar" el avatar fácilmente
const INITIAL_LIVES = 10; 
const INITIAL_ECHOES = 30;
const INITIAL_RESPAWN_PRICE = 10; 
const RESPAWN_TIMER = 30; 

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Milo",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe"
];

// Generador de números determinista
const seededRandom = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const App = () => {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Estados PWA
  const [installPrompt, setInstallPrompt] = useState(null);

  // Estados de Usuario
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ name: '', avatar: DEFAULT_AVATARS[0] });
  const [isProfileSet, setIsProfileSet] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('LOADING'); 
  const [gameMode, setGameMode] = useState('CAMPAIGN'); 
  const [currentLevel, setCurrentLevel] = useState(0);
  const [maxLevelReached, setMaxLevelReached] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Recursos
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [echoes, setEchoes] = useState(INITIAL_ECHOES);
  const [coins, setCoins] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [respawnTimeLeft, setRespawnTimeLeft] = useState(RESPAWN_TIMER);
  const [livesBoughtInSession, setLivesBoughtInSession] = useState(0);

  // Motor Refs
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const projectiles = useRef([]);
  const lastProjectileSpawn = useRef(0);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const portalCooldown = useRef(0);
  const lastHitTime = useRef(0); // Para evitar pérdida de múltiples vidas en un solo cuadro
  const audioCtx = useRef(null);
  const masterGain = useRef(null);
  const respawnTimerRef = useRef(null);

  // --- PREVENCIÓN DE SCROLL ---
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  }, []);

  // --- LÓGICA PWA ---
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  // --- FIREBASE & CACHE ---
  useEffect(() => {
    const cached = localStorage.getItem('sandeco_profile');
    if (cached) setProfile(JSON.parse(cached));
    const initAuth = async () => { try { await signInAnonymously(auth); } catch (e) { setGameState('START'); } };
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        localStorage.setItem('sandeco_profile', JSON.stringify(data));
        setIsProfileSet(true);
        setGameState('START');
      } else if (!localStorage.getItem('sandeco_profile')) {
        setGameState('SETUP');
      } else {
        setIsProfileSet(true);
        setGameState('START');
      }
    });

    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(statsRef).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setMaxLevelReached(d.maxLevel || 0);
        setCurrentLevel(d.currentLevel || 0);
        setCoins(d.coins || 0);
        setTotalScore(d.totalScore || 0);
      }
    });

    const rankingRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubRank = onSnapshot(rankingRef, (snap) => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => b.score - a.score);
      setLeaderboard(docs);
    });
    return () => unsubRank();
  }, [user]);

  // --- GENERADOR DE NIVELES (DETERMINISTA PARA CAMPAÑA) ---
  const levelData = useMemo(() => {
    const generateLevel = (index, mode) => {
      const isCampaign = mode === 'CAMPAIGN';
      let seed = isCampaign ? index * 147.2 : Math.random() * 1000000;
      const rnd = () => { seed += 1.1; return seededRandom(seed); };

      const walls = [
        { x: 0, y: 0, w: CANVAS_SIZE, h: 20, id: `b-t-${index}` },
        { x: 0, y: CANVAS_SIZE - 20, w: CANVAS_SIZE, h: 20, id: `b-b-${index}` },
        { x: 0, y: 0, w: 20, h: CANVAS_SIZE, id: `b-l-${index}` },
        { x: CANVAS_SIZE - 20, y: 0, w: 20, h: CANVAS_SIZE, id: `b-r-${index}` }
      ];

      const isSafe = (x, y, r) => !walls.some(w => {
        const cx = Math.max(w.x, Math.min(x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(y, w.y + w.h));
        return Math.hypot(x - cx, y - cy) < r + 25;
      });

      const getSafePos = (r = 25, margin = 100) => {
        for (let i = 0; i < 200; i++) {
          const x = margin + rnd() * (CANVAS_SIZE - margin * 2);
          const y = margin + rnd() * (CANVAS_SIZE - margin * 2);
          if (isSafe(x, y, r)) return { x, y };
        }
        return { x: 300, y: 300 };
      };

      for (let j = 0; j < 5 + Math.floor((index / 100) * 10); j++) {
        walls.push({ x: 100 + rnd() * 350, y: 100 + rnd() * 350, w: 45 + rnd() * 45, h: 45 + rnd() * 45, id: `w-${index}-${j}` });
      }

      const campaignFeatures = { crosses: [], patrols: [], orbits: [] };
      if (isCampaign) {
        for (let j = 0; j < 1 + Math.floor(index / 12); j++) campaignFeatures.crosses.push({ ...getSafePos(50), size: 30 + rnd() * 50, angle: 0, speed: 0.02, id: `cr-${index}-${j}` });
        for (let j = 0; j < 1 + Math.floor(index / 10); j++) campaignFeatures.patrols.push({ x: 120 + rnd() * 360, y: 120 + rnd() * 360, w: 35, h: 35, vx: rnd() > 0.5 ? 3.5 : 0, vy: rnd() > 0.5 ? 0 : 3.5, id: `pa-${index}-${j}` });
        for (let j = 0; j < 1 + Math.floor(index / 20); j++) campaignFeatures.orbits.push({ cx: 300, cy: 300, radius: 100 + rnd() * 160, angle: rnd() * Math.PI, speed: 0.015, size: 24, id: `ob-${index}-${j}` });
      }

      const movingWalls = [];
      if (!isCampaign || index > 4) {
        for (let j = 0; j < 2 + Math.floor((index / 100) * 8); j++) {
          movingWalls.push({ x: 150 + rnd() * 300, y: 150 + rnd() * 300, w: 25, h: 25, vx: (rnd() - 0.5) * (9 + (index / 100) * 10), vy: (rnd() - 0.5) * (9 + (index / 100) * 8), id: `m-${index}-${j}` });
        }
      }

      return {
        id: index, walls, movingWalls, ...campaignFeatures,
        coins: Array.from({ length: 5 }, (_, j) => ({ ...getSafePos(15, 80), id: `c-${index}-${j}`, collected: false })),
        hearts: rnd() > 0.7 ? [{ ...getSafePos(20, 80), id: `h-${index}`, collected: false }] : [],
        portalA: getSafePos(35, 80), portalB: getSafePos(35, 80),
        start: { x: 70, y: 70 }, end: { x: 530, y: 530 }, 
        key: getSafePos(25, 160) // Llave accesible
      };
    };

    return {
      campaign: Array.from({ length: 100 }, (_, i) => generateLevel(i, 'CAMPAIGN')),
      random: Array.from({ length: 100 }, (_, i) => generateLevel(i, 'RANDOM'))
    };
  }, []);

  const currentLevelData = useMemo(() => 
    gameMode === 'CAMPAIGN' ? levelData.campaign[currentLevel] : levelData.random[currentLevel]
  , [gameMode, currentLevel, levelData]);

  // --- LÓGICA DE JUEGO ---
  const saveGameState = async (override = {}) => {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    const data = { maxLevel: Math.max(maxLevelReached, currentLevel), currentLevel, coins, totalScore, lives, echoes, gameMode, ...override };
    await setDoc(statsRef, data, { merge: true });
    await setDoc(leadRef, { name: profile.name, avatar: profile.avatar, score: totalScore, level: currentLevel + 1, uid: user.uid }, { merge: true });
  };

  const handleExitToMenu = async () => { 
    await saveGameState(); 
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current); 
    setGameState('START'); 
  };

  const saveProfile = async () => { 
    if (!profile.name.trim() || !user) return; 
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'); 
    await setDoc(profileRef, profile); 
    localStorage.setItem('sandeco_profile', JSON.stringify(profile)); 
    setIsProfileSet(true); 
    setGameState('START'); 
  };

  const handleImageUpload = (e) => { 
    const file = e.target.files[0]; 
    if (file) { 
      const r = new FileReader(); 
      r.onloadend = () => setProfile(p => ({ ...p, avatar: r.result })); 
      r.readAsDataURL(file); 
    } 
  };

  const toggleFullscreen = () => { 
    if (!document.fullscreenElement) { 
      document.documentElement.requestFullscreen().catch(()=>{}); 
      setIsFullscreen(true); 
    } else { 
      document.exitFullscreen().catch(()=>{}); 
      setIsFullscreen(false); 
    } 
  };

  const playSound = (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
    if (isMuted) return;
    try {
      if (!audioCtx.current) { audioCtx.current = new (window.AudioContext || window.webkitAudioContext)(); masterGain.current = audioCtx.current.createGain(); masterGain.current.connect(audioCtx.current.destination); }
      const osc = audioCtx.current.createOscillator(); const g = audioCtx.current.createGain(); osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime); g.gain.setValueAtTime(vol, audioCtx.current.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.current.currentTime + duration); osc.connect(g); g.connect(masterGain.current); osc.start(); osc.stop(audioCtx.current.currentTime + duration);
    } catch (e) {}
  };

  // Sincronización inicial
  useEffect(() => {
    if (gameState === 'PLAYING') {
      playerPos.current = { ...currentLevelData.start };
      pulses.current = [];
      projectiles.current = [];
      visibilityMap.current.clear();
      isDragging.current = false;
      lastHitTime.current = 0;
    }
  }, [currentLevel, gameMode, gameState]);

  // --- MOTOR DE RENDER Y EVENTOS ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrame;
    const level = currentLevelData;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      return { 
        x: (clientX - rect.left) * (CANVAS_SIZE / rect.width), 
        y: (clientY - rect.top) * (CANVAS_SIZE / rect.height) 
      };
    };

    const handleInputDown = (e) => {
      const pos = getPos(e);
      const dist = Math.hypot(pos.x - playerPos.current.x, pos.y - playerPos.current.y);
      if (dist < HITBOX_RELAX) {
        isDragging.current = true;
      } else {
        if (echoes > 0) {
          pulses.current.push({ x: pos.x, y: pos.y, r: 0, maxR: 450, alpha: 1 });
          setEchoes(v => v - 1);
          playSound(440, 'sine', 0.2, 0.05);
        }
      }
    };

    const handleInputMove = (e) => {
      if (!isDragging.current) return;
      if (e.cancelable) e.preventDefault();
      const pos = getPos(e);
      playerPos.current = { 
        x: Math.max(PLAYER_RADIUS, Math.min(CANVAS_SIZE - PLAYER_RADIUS, pos.x)), 
        y: Math.max(PLAYER_RADIUS, Math.min(CANVAS_SIZE - PLAYER_RADIUS, pos.y)) 
      };
    };

    const handleInputUp = () => { isDragging.current = false; };

    canvas.addEventListener('mousedown', handleInputDown);
    canvas.addEventListener('touchstart', handleInputDown, { passive: false });
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('touchmove', handleInputMove, { passive: false });
    window.addEventListener('mouseup', handleInputUp);
    window.addEventListener('touchend', handleInputUp);

    const handleCollision = () => {
      // SEGURO: Si acabamos de chocar hace menos de 500ms, ignoramos para no perder más de 1 vida
      if (Date.now() - lastHitTime.current < 500) return;
      lastHitTime.current = Date.now();

      setLives(prev => {
        const next = prev - 1;
        if (next <= 0) { 
          setGameState('RESPAWN'); 
          setRespawnTimeLeft(RESPAWN_TIMER); 
          startRespawnTimer(); 
          return 0; 
        } else { 
          playSound(150, 'square', 0.3, 0.2);
          playerPos.current = { ...level.start }; 
          visibilityMap.current.clear(); 
          projectiles.current = []; 
          pulses.current = []; 
          isDragging.current = false;
          return next; 
        }
      });
    };

    const render = (time) => {
      ctx.fillStyle = '#01050a'; ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (time - lastProjectileSpawn.current > Math.max(350, 2500 - currentLevel * 60)) {
        const side = Math.floor(Math.random() * 4);
        const speed = 4 + (currentLevel * 0.15);
        let x, y, vx, vy;
        if (side === 0) { x = Math.random() * CANVAS_SIZE; y = -30; vx = 0; vy = speed; }
        else if (side === 1) { x = CANVAS_SIZE + 30; y = Math.random() * CANVAS_SIZE; vx = -speed; vy = 0; }
        else if (side === 2) { x = Math.random() * CANVAS_SIZE; y = CANVAS_SIZE + 30; vx = 0; vy = -speed; }
        else { x = -30; y = Math.random() * CANVAS_SIZE; vx = speed; vy = 0; }
        projectiles.current.push({ x, y, vx, vy, id: Math.random() });
        lastProjectileSpawn.current = time;
      }

      // Ecos
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 10; p.alpha *= 0.96; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`; ctx.lineWidth = 2; ctx.stroke();
        const reveal = (o, isC = false) => {
          let d = isC ? Math.hypot(p.x - o.x, p.y - o.y) : Math.hypot(p.x - Math.max(o.x, Math.min(p.x, o.x + o.w)), p.y - Math.max(o.y, Math.min(p.y, o.y + o.h)));
          if (Math.abs(d - p.r) < 45) visibilityMap.current.set(o.id || 'key', 1);
        };
        level.walls.forEach(w => reveal(w)); level.movingWalls.forEach(m => reveal(m));
        level.crosses?.forEach(c => reveal(c, true)); level.patrols?.forEach(pt => reveal(pt));
        level.orbits?.forEach(ob => reveal(ob, true));
        level.coins.forEach(c => reveal(c, true)); level.hearts.forEach(h => reveal(h, true));
        reveal(level.portalA, true); reveal(level.portalB, true); reveal(level.key, true);
      });

      // Muros
      level.walls.forEach(w => {
        const op = visibilityMap.current.get(w.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(34, 211, 238, ${op})`; ctx.fillRect(w.x, w.y, w.w, w.h); visibilityMap.current.set(w.id, op - 0.01); }
        const cx = Math.max(w.x, Math.min(playerPos.current.x, w.x + w.w)); const cy = Math.max(w.y, Math.min(playerPos.current.y, w.y + w.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 2) handleCollision();
      });

      // Cruces
      level.crosses?.forEach(c => {
        c.angle += c.speed; const op = visibilityMap.current.get(c.id) || 0;
        if (op > 0) {
          ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle); ctx.strokeStyle = `rgba(244, 63, 94, ${op})`; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(-c.size, 0); ctx.lineTo(c.size, 0); ctx.moveTo(0, -c.size); ctx.lineTo(0, c.size); ctx.stroke(); ctx.restore();
          visibilityMap.current.set(c.id, op - 0.01);
        }
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < c.size + PLAYER_RADIUS) {
          const la = Math.atan2(playerPos.current.y - c.y, playerPos.current.x - c.x) - c.angle;
          const n = ((la % (Math.PI / 2)) + (Math.PI / 2)) % (Math.PI / 2);
          if (n < 0.22 || n > (Math.PI / 2 - 0.22)) handleCollision();
        }
      });

      // Patrullas
      level.patrols?.forEach(pt => {
        pt.x += pt.vx; pt.y += pt.vy;
        if (pt.x < 20 || pt.x > CANVAS_SIZE - 20 - pt.w) pt.vx *= -1;
        if (pt.y < 20 || pt.y > CANVAS_SIZE - 20 - pt.h) pt.vy *= -1;
        const op = visibilityMap.current.get(pt.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(244, 63, 94, ${op})`; ctx.fillRect(pt.x, pt.y, pt.w, pt.h); visibilityMap.current.set(pt.id, op - 0.015); }
        const cx = Math.max(pt.x, Math.min(playerPos.current.x, pt.x + pt.w)); const cy = Math.max(pt.y, Math.min(playerPos.current.y, pt.y + pt.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 1) handleCollision();
      });

      // Órbitas
      level.orbits?.forEach(ob => {
        ob.angle += ob.speed;
        const ox = ob.cx + Math.cos(ob.angle) * ob.radius;
        const oy = ob.cy + Math.sin(ob.angle) * ob.radius;
        const op = visibilityMap.current.get(ob.id) || 0;
        if (op > 0) { ctx.beginPath(); ctx.arc(ox, oy, ob.size, 0, Math.PI * 2); ctx.fillStyle = `rgba(244, 63, 94, ${op})`; ctx.fill(); visibilityMap.current.set(ob.id, op - 0.01); }
        if (Math.hypot(playerPos.current.x - ox, playerPos.current.y - oy) < ob.size + PLAYER_RADIUS - 5) handleCollision();
      });

      // Portales
      const drawPortal = (p, target, id) => {
        const op = visibilityMap.current.get(`portal-${id}`) || 0;
        if (op > 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, Math.PI * 2); ctx.strokeStyle = `rgba(168, 85, 247, ${op})`; ctx.lineWidth = 4; ctx.stroke(); visibilityMap.current.set(`portal-${id}`, op - 0.005); }
        if (portalCooldown.current <= 0 && Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < 25) { playerPos.current = { ...target }; portalCooldown.current = 60; playSound(600, 'sine', 0.4, 0.2); }
      };
      drawPortal(level.portalA, level.portalB, 'A'); drawPortal(level.portalB, level.portalA, 'B');
      if (portalCooldown.current > 0) portalCooldown.current--;

      // Flechas
      projectiles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        if (Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < PLAYER_RADIUS + 6) handleCollision();
      });
      projectiles.current = projectiles.current.filter(p => p.x > -60 && p.x < 660 && p.y > -60 && p.y < 660);

      // Items
      level.coins.forEach(c => {
        if (c.collected) return; const op = visibilityMap.current.get(c.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(251, 191, 36, ${op})`; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.fill(); visibilityMap.current.set(c.id, op - 0.005); }
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < 25) { c.collected = true; setCoins(v => v + 1); setTotalScore(v => v + 50); playSound(1000, 'sine', 0.1, 0.1); }
      });
      level.hearts.forEach(h => {
        if (h.collected) return; const op = visibilityMap.current.get(h.id) || 0;
        if (op > 0) { ctx.font = '24px Arial'; ctx.globalAlpha = op; ctx.fillText('❤️', h.x, h.y + 8); ctx.globalAlpha = 1; visibilityMap.current.set(h.id, op - 0.005); }
        if (Math.hypot(playerPos.current.x - h.x, playerPos.current.y - h.y) < 25) { h.collected = true; setLives(v => Math.min(v + 1, 15)); playSound(800, 'sine', 0.3, 0.2); }
      });

      if (!hasKey) {
        const op = visibilityMap.current.get('key') || 0;
        if (op > 0) { ctx.font = '26px Arial'; ctx.textAlign = 'center'; ctx.globalAlpha = op; ctx.fillText('🔑', level.key.x, level.key.y + 8); ctx.globalAlpha = 1; visibilityMap.current.set('key', op - 0.005); }
        if (Math.hypot(playerPos.current.x - level.key.x, playerPos.current.y - level.key.y) < 30) { setHasKey(true); playSound(900, 'triangle', 0.4, 0.2); }
      }
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(level.end.x, level.end.y, 38, 0, Math.PI * 2); ctx.stroke();
      if (hasKey && Math.hypot(playerPos.current.x - level.end.x, playerPos.current.y - level.end.y) < 38) winLevel();

      // Avatar
      ctx.save(); ctx.beginPath(); ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.clip();
      const img = new Image(); img.src = profile.avatar; ctx.drawImage(img, playerPos.current.x - PLAYER_RADIUS, playerPos.current.y - PLAYER_RADIUS, PLAYER_RADIUS*2, PLAYER_RADIUS*2); ctx.restore();
      
      animationFrame = requestAnimationFrame(render);
    };

    const winLevel = () => {
      const next = currentLevel + 1; setCurrentLevel(next); setMaxLevelReached(v => Math.max(v, next)); setTotalScore(v => v + 1000); setHasKey(false);
      visibilityMap.current.clear(); playerPos.current = { ...level.start }; playSound(1200, 'sine', 0.5, 0.2); saveGameState({ currentLevel: next, totalScore: totalScore + 1000 });
    };

    animationFrame = requestAnimationFrame(render);
    return () => { 
      cancelAnimationFrame(animationFrame); 
      canvas.removeEventListener('mousedown', handleInputDown); canvas.removeEventListener('touchstart', handleInputDown);
      window.removeEventListener('mousemove', handleInputMove); window.removeEventListener('touchmove', handleInputMove);
      window.removeEventListener('mouseup', handleInputUp); window.removeEventListener('touchend', handleInputUp);
    };
  }, [gameState, currentLevelData, hasKey, isMuted, profile.avatar]);

  // Respawn Timer
  const startRespawnTimer = () => {
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    respawnTimerRef.current = setInterval(() => { setRespawnTimeLeft(prev => { if (prev <= 1) { clearInterval(respawnTimerRef.current); restartFromLevel1(); return 0; } return prev - 1; }); }, 1000);
  };
  const currentRespawnPrice = useMemo(() => Math.max(1, INITIAL_RESPAWN_PRICE - livesBoughtInSession), [livesBoughtInSession]);
  const buyLife = () => { if (coins >= currentRespawnPrice) { setCoins(v => v - currentRespawnPrice); setLives(v => v + 1); setLivesBoughtInSession(v => v + 1); playSound(700, 'sine', 0.2, 0.2); } };
  const continueAfterRespawn = () => { if (lives > 0) { if (respawnTimerRef.current) clearInterval(respawnTimerRef.current); setGameState('PLAYING'); } };
  const restartFromLevel1 = () => { if (respawnTimerRef.current) clearInterval(respawnTimerRef.current); setCurrentLevel(0); setLives(INITIAL_LIVES); setEchoes(INITIAL_ECHOES); setHasKey(false); playerPos.current = { x: 70, y: 70 }; visibilityMap.current.clear(); setGameState('PLAYING'); saveGameState({ currentLevel: 0, lives: INITIAL_LIVES }); };

  if (gameState === 'LOADING') return <div className="h-screen bg-slate-950 flex items-center justify-center text-cyan-400 font-black tracking-widest uppercase">Cargando...</div>;

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white overflow-y-auto">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] w-full max-w-md text-center backdrop-blur-xl">
          <h2 className="text-2xl font-black italic mb-6 uppercase tracking-tighter text-white">Crea tu Piloto</h2>
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <img src={profile.avatar} className="w-24 h-24 rounded-full border-4 border-cyan-500 object-cover shadow-xl" alt="Avatar" />
              <button onClick={() => fileInputRef.current.click()} className="absolute bottom-0 right-0 bg-cyan-500 p-2 rounded-full border-2 border-slate-900 text-slate-900 shadow-lg hover:scale-110 transition-transform">📷</button>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
            </div>
            <div className="flex gap-2 pb-2 overflow-x-auto w-full justify-center text-white">
              {DEFAULT_AVATARS.map((av, i) => (<button key={i} onClick={() => setProfile({ ...profile, avatar: av })} className="w-10 h-10 rounded-full border-2 border-slate-700 overflow-hidden flex-shrink-0 hover:border-cyan-500"><img src={av} alt="cartoon" /></button>))}
            </div>
            <input type="text" placeholder="Nombre..." className="w-full p-4 bg-slate-950 rounded-xl border border-slate-800 text-white font-bold text-center outline-none focus:border-cyan-500" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <button onClick={saveProfile} className="w-full py-4 bg-cyan-500 text-slate-950 font-black rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg uppercase">Registrarse</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col h-screen overflow-hidden select-none touch-none font-sans">
      <header className="flex-none p-4 flex flex-col gap-3 bg-slate-900/50 border-b border-slate-800/50 z-50">
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-3">
             <img src={profile.avatar} className="w-10 h-10 rounded-full border-2 border-cyan-500 shadow-lg" alt="p" />
             <div className="hidden sm:block">
               <div className="font-black text-sm leading-none truncate max-w-[100px] text-white">{profile.name}</div>
               <div className="text-[7px] text-cyan-500 uppercase font-black tracking-widest mt-1 text-white">MODO: {gameMode}</div>
             </div>
          </div>
          <h1 className="text-xl font-black italic tracking-tighter uppercase leading-none bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent">
            SANDECO <span className="text-cyan-400">BALL</span> ⚪
          </h1>
          <div className="flex gap-2 items-center">
            {installPrompt && (
              <button onClick={handleInstallClick} className="px-3 py-2 bg-amber-500 text-slate-900 rounded-xl font-black text-[10px] hover:scale-105 animate-pulse shadow-lg">INSTALAR</button>
            )}
            <button onClick={() => setIsMuted(!isMuted)} className="p-2 bg-slate-800 border border-slate-700 rounded-xl w-10 h-10 flex items-center justify-center">
               {isMuted ? '🔇' : '🔊'}
            </button>
            <button onClick={toggleFullscreen} className="p-2 bg-slate-800 border border-slate-700 rounded-xl w-10 h-10 flex items-center justify-center">
               {isFullscreen ? '⤓' : '⤢'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1 text-white">
          <StatBox label="Nivel" value={currentLevel + 1} />
          <StatBox label="Vidas" value={lives} color={lives < 3 ? 'text-red-500' : 'text-white'} />
          <StatBox label="Ecos" value={echoes} color="text-cyan-400" />
          <StatBox label="Coins" value={coins} color="text-amber-400" />
          <StatBox label="Score" value={totalScore} color="text-emerald-400" />
        </div>
      </header>

      <main className="flex-1 relative flex items-center justify-center bg-black overflow-hidden p-2">
        <div className="relative w-full h-full max-w-[600px] max-h-[600px] aspect-square">
          <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="w-full h-full object-contain block touch-none border-2 border-slate-800 rounded-2xl bg-[#01050a]" />

          {gameState === 'START' && (
            <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-md z-40 rounded-2xl text-white">
              <h1 className="text-4xl sm:text-6xl font-black italic mb-2 tracking-tighter uppercase text-white drop-shadow-lg">SANDECO BALL</h1>
              <p className="text-slate-400 mb-8 max-w-xs text-xs font-bold uppercase tracking-widest leading-relaxed">Supervivencia y Reflejos</p>
              <div className="flex flex-col gap-4 w-full max-w-xs text-white">
                <button onClick={() => { setGameMode('CAMPAIGN'); setGameState('PLAYING'); }} className="py-5 bg-cyan-500 text-slate-950 font-black rounded-3xl text-2xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-cyan-500/30 uppercase">CAMPAÑA</button>
                <button onClick={() => { setGameMode('RANDOM'); setGameState('PLAYING'); }} className="py-5 bg-slate-100 text-slate-950 font-black rounded-3xl text-2xl hover:scale-105 active:scale-95 transition-all uppercase">ALEATORIO</button>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setGameState('RANKING')} className="py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase hover:bg-slate-800 text-white">Ranking</button>
                  <button onClick={() => setGameState('STORE')} className="py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase hover:bg-slate-800 text-white">Tienda</button>
                </div>
              </div>
            </div>
          )}

          {gameState === 'RESPAWN' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-6 text-center backdrop-blur-xl z-40 rounded-2xl overflow-y-auto text-white">
              <div className="text-7xl mb-4 animate-bounce">💀</div>
              <h2 className="text-3xl font-black text-white mb-2 uppercase italic tracking-tighter">SISTEMA DAÑADO</h2>
              <div className="text-7xl font-black text-cyan-400 mb-6 tabular-nums animate-pulse">{respawnTimeLeft}s</div>
              <div className="flex flex-col gap-3 w-full max-w-xs text-white">
                <button onClick={buyLife} disabled={coins < currentRespawnPrice} className={`py-4 rounded-xl font-black text-lg transition-all shadow-lg ${coins >= currentRespawnPrice ? 'bg-amber-500 text-slate-950 hover:scale-105 active:scale-95' : 'bg-slate-800 text-slate-600'}`}>
                  {coins >= currentRespawnPrice ? `COMPRAR VIDA (${currentRespawnPrice} 🪙)` : `FALTAN ${currentRespawnPrice - coins} 🪙`}
                </button>
                <button onClick={continueAfterRespawn} disabled={lives === 0} className={`py-4 font-black rounded-xl text-lg uppercase shadow-md transition-all ${lives > 0 ? 'bg-cyan-500 text-slate-950 hover:scale-105' : 'bg-slate-800 text-slate-600 opacity-50 cursor-not-allowed'}`}>Continuar</button>
                <button onClick={restartFromLevel1} className="py-3 bg-white text-slate-900 font-black rounded-xl text-sm uppercase">Nivel 1</button>
                <button onClick={handleExitToMenu} className="py-3 bg-red-600/10 text-red-500 border border-red-500/30 font-black rounded-xl text-sm uppercase">Menú Principal</button>
              </div>
            </div>
          )}

          {gameState === 'RANKING' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl z-40 rounded-2xl text-white text-left">
               <div className="flex justify-between items-center mb-6 text-white"><h2 className="text-2xl font-black italic uppercase text-cyan-400">Récords</h2><button onClick={() => setGameState('START')} className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-full text-white font-bold text-xl flex items-center justify-center hover:bg-slate-700 text-white">✕</button></div>
               <div className="space-y-2 overflow-y-auto pr-2 flex-1 scrollbar-hide text-white">
                  {leaderboard.map((p, i) => (
                    <div key={i} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${p.uid === user?.uid ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'bg-slate-900/50 border-slate-800'}`}>
                      <div className="flex items-center gap-4 text-white">
                        <span className={`w-6 font-black text-xs ${i < 3 ? 'text-amber-400' : 'text-slate-600'}`}>{i + 1}</span>
                        <img src={p.avatar} className="w-10 h-10 rounded-full border border-slate-700" alt="" />
                        <div className="text-left"><div className="font-bold text-sm text-white leading-tight truncate max-w-[100px]">{p.name}</div><div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Lv {p.level}</div></div>
                      </div>
                      <div className="text-cyan-400 font-black text-lg tracking-tighter">{p.score.toLocaleString()}</div>
                    </div>
                  ))}
               </div>
            </div>
          )}

          {gameState === 'STORE' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl z-40 rounded-2xl text-white">
               <div className="flex justify-between items-center mb-8 text-white"><h2 className="text-2xl font-black italic uppercase text-white">Almacén</h2><button onClick={() => setGameState('START')} className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-full text-white font-bold text-xl flex items-center justify-center hover:bg-slate-700 text-white text-white">✕</button></div>
               <div className="space-y-4">
                 <StoreItem title="Bolsa de 15 Ecos" price="10 🪙" onBuy={() => { if(coins >= 10) { setCoins(v=>v-10); setEchoes(v=>v+15); } }} />
                 <StoreItem title="Vida Extra" price="25 🪙" onBuy={() => { if(coins >= 25) { setCoins(v=>v-25); setLives(v=>Math.min(v+1, 15)); } }} />
                 <StoreItem title="Energía Máxima (50 Ecos)" price="30 🪙" onBuy={() => { if(coins >= 30) { setCoins(v=>v-30); setEchoes(v=>v+50); } }} />
               </div>
            </div>
          )}
        </div>
      </main>

      <footer className="flex-none p-4 bg-slate-900/50 border-t border-slate-800/50 flex flex-col items-center gap-3 z-50 text-white">
        {gameState === 'PLAYING' && (
          <button onClick={handleExitToMenu} className="w-full max-w-[600px] py-4 bg-slate-950 border border-slate-800 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all shadow-xl hover:bg-slate-800 text-white text-white">← Guardar y Salir</button>
        )}
        <p className="text-[9px] text-slate-600 font-black uppercase tracking-[0.5em] animate-pulse text-white">Arrastra el Piloto • Pulsa para Eco</p>
      </footer>
    </div>
  );
};

const StatBox = ({ label, value, color = "text-white" }) => (
  <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/50 text-center flex flex-col justify-center min-w-0 shadow-inner text-white">
    <div className="text-[7px] sm:text-[9px] text-slate-600 font-black uppercase tracking-widest mb-1 leading-none text-white">{label}</div>
    <div className={`text-xs sm:text-base font-black ${color} tracking-tighter leading-none text-white`}>{value}</div>
  </div>
);

const StoreItem = ({ title, price, onBuy }) => (
  <button onClick={onBuy} className="w-full flex justify-between items-center p-5 bg-slate-900 border border-slate-800 rounded-3xl hover:bg-slate-800 transition-all shadow-lg active:scale-95 group text-white">
    <div className="text-left text-white">
        <div className="font-black text-sm text-white group-hover:text-cyan-400 transition-colors uppercase tracking-tight text-white">{title}</div>
        <div className="text-[9px] text-slate-500 uppercase font-black tracking-widest leading-none mt-1 text-white text-left">Equipo de Supervivencia</div>
    </div>
    <span className="bg-amber-500 text-slate-950 px-4 py-2 rounded-xl font-black text-xs shadow-md group-active:scale-95 transition-transform text-white">{price}</span>
  </button>
);

export default App;

