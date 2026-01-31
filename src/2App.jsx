import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE (PROPORCIONADA POR EL USUARIO) ---
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
// El appId se usa para cumplir con la regla de rutas de Firestore: /artifacts/{appId}/...
const appId = typeof __app_id !== 'undefined' ? __app_id : 'sandeco-ball-v1';

// --- CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 18; 
const HITBOX_RELAX = 45;
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

const App = () => {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Estados de Usuario
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ name: '', avatar: DEFAULT_AVATARS[0] });
  const [isProfileSet, setIsProfileSet] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('LOADING'); 
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
  
  // Respawn y Lógica de Compra
  const [respawnTimeLeft, setRespawnTimeLeft] = useState(RESPAWN_TIMER);
  const [livesBoughtInSession, setLivesBoughtInSession] = useState(0);

  // Referencias de Motor
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const projectiles = useRef([]);
  const lastProjectileSpawn = useRef(0);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const audioCtx = useRef(null);
  const masterGain = useRef(null);
  const respawnTimerRef = useRef(null);

  // --- PREVENCIÓN DE SCROLL GLOBAL ---
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = 'auto';
      document.body.style.touchAction = 'auto';
    };
  }, []);

  // --- FIREBASE & CACHE INIT ---
  useEffect(() => {
    // Intentar cargar perfil desde el Caché (localStorage) primero para rapidez
    const cachedProfile = localStorage.getItem('sandeco_profile');
    if (cachedProfile) {
      setProfile(JSON.parse(cachedProfile));
    }

    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { console.error("Error Auth:", e); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Cargar perfil desde Firestore (Sincronización)
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile({ name: data.name, avatar: data.avatar });
        localStorage.setItem('sandeco_profile', JSON.stringify({ name: data.name, avatar: data.avatar }));
        setIsProfileSet(true);
        setGameState('START');
      } else if (!localStorage.getItem('sandeco_profile')) {
        setGameState('SETUP');
      } else {
        setIsProfileSet(true);
        setGameState('START');
      }
    });

    // Cargar estadísticas guardadas
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(statsRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setMaxLevelReached(data.maxLevel || 0);
        setCurrentLevel(data.currentLevel || 0);
        setCoins(data.coins || 0);
        setTotalScore(data.totalScore || 0);
        setLives(data.lives || INITIAL_LIVES);
        setEchoes(data.echoes || INITIAL_ECHOES);
      }
    });

    // Sincronizar Ranking (Público)
    const rankingRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubRanking = onSnapshot(rankingRef, (snap) => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => b.score - a.score);
      setLeaderboard(docs);
    });

    return () => unsubRanking();
  }, [user]);

  // --- PERSISTENCIA ---
  const saveGameState = async (override = {}) => {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    
    const stateToSave = {
      maxLevel: Math.max(maxLevelReached, currentLevel),
      currentLevel, coins, totalScore, lives, echoes,
      ...override
    };

    await setDoc(statsRef, stateToSave, { merge: true });
    await setDoc(leadRef, { 
      name: profile.name, avatar: profile.avatar, score: totalScore, level: currentLevel + 1, uid: user.uid 
    }, { merge: true });
  };

  const handleExitToMenu = async () => {
    await saveGameState();
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    setGameState('START');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const saveProfile = async () => {
    if (!profile.name.trim() || !user) return;
    
    // Guardar en Firestore
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    await setDoc(profileRef, profile);
    
    // Guardar en Caché Local
    localStorage.setItem('sandeco_profile', JSON.stringify(profile));
    
    setIsProfileSet(true);
    setGameState('START');
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setProfile(prev => ({ ...prev, avatar: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  // --- MOTOR DE NIVELES ---
  const levelData = useMemo(() => {
    const isSafe = (x, y, radius, walls) => {
      return !walls.some(w => {
        const cx = Math.max(w.x, Math.min(x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(y, w.y + w.h));
        const dist = Math.hypot(x - cx, y - cy);
        return dist < radius + 18; 
      });
    };

    const getSafePos = (walls, radius = 25) => {
      let attempts = 0;
      while (attempts < 200) {
        const x = 90 + Math.random() * (CANVAS_SIZE - 180);
        const y = 90 + Math.random() * (CANVAS_SIZE - 180);
        if (isSafe(x, y, radius, walls)) return { x, y };
        attempts++;
      }
      return { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
    };

    return Array.from({ length: 100 }, (_, i) => {
      const diff = i / 100;
      const walls = [
        { x: 0, y: 0, w: CANVAS_SIZE, h: 20, id: `b-t-${i}` },
        { x: 0, y: CANVAS_SIZE - 20, w: CANVAS_SIZE, h: 20, id: `b-b-${i}` },
        { x: 0, y: 0, w: 20, h: CANVAS_SIZE, id: `b-l-${i}` },
        { x: CANVAS_SIZE - 20, y: 0, w: 20, h: CANVAS_SIZE, id: `b-r-${i}` }
      ];

      for (let j = 0; j < 6 + Math.floor(diff * 20); j++) {
        walls.push({ 
          x: 100 + Math.random() * 380, 
          y: 100 + Math.random() * 380, 
          w: 40 + Math.random() * 60, 
          h: 40 + Math.random() * 60, 
          id: `w-${i}-${j}` 
        });
      }

      const coinsOnMap = Array.from({ length: 5 }, (_, j) => {
        const pos = getSafePos(walls, 15);
        return { ...pos, id: `c-${i}-${j}`, collected: false };
      });

      const healthPacks = [];
      if (Math.random() > 0.5) {
        const pos = getSafePos(walls, 20);
        healthPacks.push({ ...pos, id: `h-${i}`, collected: false });
      }

      const echoPacks = [];
      if (Math.random() > 0.5) {
        const pos = getSafePos(walls, 20);
        echoPacks.push({ ...pos, id: `e-${i}`, collected: false });
      }

      const movingWalls = [];
      if (i >= 1) {
        for (let j = 0; j < 2 + Math.floor(diff * 15); j++) {
          movingWalls.push({ 
            x: 150 + Math.random() * 300, 
            y: 150 + Math.random() * 300, 
            w: 25, h: 25, 
            vx: (Math.random() - 0.5) * (7 + diff * 10), 
            vy: (Math.random() - 0.5) * (7 + diff * 10), 
            id: `m-${i}-${j}` 
          });
        }
      }

      return {
        id: i, walls, movingWalls, coins: coinsOnMap, healthPacks, echoPacks,
        start: { x: 70, y: 70 }, 
        end: { x: 530, y: 530 }, 
        key: getSafePos(walls, 25)
      };
    });
  }, []);

  // --- AUDIO ---
  const playSound = (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
    if (isMuted) return;
    try {
      if (!audioCtx.current) {
        audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
        masterGain.current = audioCtx.current.createGain();
        masterGain.current.connect(audioCtx.current.destination);
      }
      const osc = audioCtx.current.createOscillator();
      const g = audioCtx.current.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
      g.gain.setValueAtTime(vol, audioCtx.current.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.current.currentTime + duration);
      osc.connect(g);
      g.connect(masterGain.current);
      osc.start();
      osc.stop(audioCtx.current.currentTime + duration);
    } catch (e) {}
  };

  // --- JUEGO ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrame;
    const level = levelData[currentLevel];

    const spawnArrow = () => {
      const side = Math.floor(Math.random() * 4);
      const speed = 4 + (currentLevel * 0.15);
      let x, y, vx, vy;
      if (side === 0) { x = Math.random() * CANVAS_SIZE; y = -30; vx = 0; vy = speed; }
      else if (side === 1) { x = CANVAS_SIZE + 30; y = Math.random() * CANVAS_SIZE; vx = -speed; vy = 0; }
      else if (side === 2) { x = Math.random() * CANVAS_SIZE; y = CANVAS_SIZE + 30; vx = 0; vy = -speed; }
      else { x = -30; y = Math.random() * CANVAS_SIZE; vx = speed; vy = 0; }
      projectiles.current.push({ x, y, vx, vy, id: Math.random() });
    };

    const handleInputDown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX || e.touches?.[0].clientX) - rect.left;
      const cy = (e.clientY || e.touches?.[0].clientY) - rect.top;
      const x = cx * (CANVAS_SIZE / rect.width);
      const y = cy * (CANVAS_SIZE / rect.height);

      if (Math.hypot(x - playerPos.current.x, y - playerPos.current.y) < HITBOX_RELAX) {
        isDragging.current = true;
      } else if (echoes > 0) {
        pulses.current.push({ x, y, r: 0, maxR: 450, alpha: 1 });
        setEchoes(v => v - 1);
        playSound(440, 'sine', 0.2, 0.05);
      }
    };

    const handleInputMove = (e) => {
      if (!isDragging.current) return;
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX || e.touches?.[0].clientX) - rect.left;
      const cy = (e.clientY || e.touches?.[0].clientY) - rect.top;
      playerPos.current = { x: cx * (CANVAS_SIZE / rect.width), y: cy * (CANVAS_SIZE / rect.height) };
    };

    const handleInputUp = () => isDragging.current = false;

    canvas.addEventListener('mousedown', handleInputDown);
    canvas.addEventListener('touchstart', handleInputDown, { passive: false });
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('touchmove', handleInputMove, { passive: false });
    window.addEventListener('mouseup', handleInputUp);
    window.addEventListener('touchend', handleInputUp);

    const render = (time) => {
      ctx.fillStyle = '#01050a';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (time - lastProjectileSpawn.current > Math.max(350, 2500 - currentLevel * 60)) {
        spawnArrow();
        lastProjectileSpawn.current = time;
      }

      // 1. Eco
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 10; p.alpha *= 0.96;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`; ctx.lineWidth = 2; ctx.stroke();
        const reveal = (o, isC = false) => {
          let d = isC ? Math.hypot(p.x - o.x, p.y - o.y) : Math.hypot(p.x - Math.max(o.x, Math.min(p.x, o.x + o.w)), p.y - Math.max(o.y, Math.min(p.y, o.y + o.h)));
          if (Math.abs(d - p.r) < 35) visibilityMap.current.set(o.id || 'key', 1);
        };
        level.walls.forEach(w => reveal(w));
        level.movingWalls.forEach(m => reveal(m));
        level.coins.forEach(c => reveal(c, true));
        level.healthPacks.forEach(h => reveal(h, true));
        level.echoPacks.forEach(e => reveal(e, true));
        reveal(level.key, true);
      });

      // 2. Obstáculos
      level.walls.forEach(w => {
        const op = visibilityMap.current.get(w.id) || 0;
        if (op > 0) {
          ctx.fillStyle = `rgba(34, 211, 238, ${op})`; ctx.fillRect(w.x, w.y, w.w, w.h);
          visibilityMap.current.set(w.id, op - 0.01);
        }
        const cx = Math.max(w.x, Math.min(playerPos.current.x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(playerPos.current.y, w.y + w.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 2) handleCollision();
      });

      level.movingWalls.forEach(m => {
        m.x += m.vx; m.y += m.vy;
        if (m.x < 20 || m.x > CANVAS_SIZE - 20 - m.w) m.vx *= -1;
        if (m.y < 20 || m.y > CANVAS_SIZE - 20 - m.h) m.vy *= -1;
        const op = visibilityMap.current.get(m.id) || 0;
        if (op > 0) {
          ctx.fillStyle = `rgba(244, 63, 94, ${op})`; ctx.fillRect(m.x, m.y, m.w, m.h);
          visibilityMap.current.set(m.id, op - 0.015);
        }
        const cx = Math.max(m.x, Math.min(playerPos.current.x, m.x + m.w));
        const cy = Math.max(m.y, Math.min(playerPos.current.y, m.y + m.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 1) handleCollision();
      });

      // 3. Proyectiles
      projectiles.current = projectiles.current.filter(p => p.x > -60 && p.x < 660 && p.y > -60 && p.y < 660);
      projectiles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        if (Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < PLAYER_RADIUS + 6) handleCollision();
      });

      // 4. Objetos
      level.coins.forEach(c => {
        if (c.collected) return;
        const op = visibilityMap.current.get(c.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(251, 191, 36, ${op})`; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.fill(); visibilityMap.current.set(c.id, op - 0.005); }
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < 22 + PLAYER_RADIUS/2) { c.collected = true; setCoins(v => v + 1); setTotalScore(v => v + 50); playSound(1000, 'sine', 0.1, 0.1); }
      });
      level.healthPacks.forEach(h => {
        if (h.collected) return;
        const op = visibilityMap.current.get(h.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(34, 197, 94, ${op})`; ctx.beginPath(); ctx.arc(h.x, h.y, 10, 0, Math.PI * 2); ctx.fill(); visibilityMap.current.set(h.id, op - 0.005); }
        if (Math.hypot(playerPos.current.x - h.x, playerPos.current.y - h.y) < 24 + PLAYER_RADIUS/2) { h.collected = true; setLives(v => Math.min(v + 1, 15)); playSound(800, 'sine', 0.3, 0.2); }
      });
      level.echoPacks.forEach(e => {
        if (e.collected) return;
        const op = visibilityMap.current.get(e.id) || 0;
        if (op > 0) { ctx.fillStyle = `rgba(34, 211, 238, ${op})`; ctx.beginPath(); ctx.arc(e.x, e.y, 10, 0, Math.PI * 2); ctx.fill(); visibilityMap.current.set(e.id, op - 0.005); }
        if (Math.hypot(playerPos.current.x - e.x, playerPos.current.y - e.y) < 24 + PLAYER_RADIUS/2) { e.collected = true; setEchoes(v => v + 15); playSound(1200, 'sine', 0.3, 0.2); }
      });

      // 5. Salida
      if (!hasKey) {
        const op = visibilityMap.current.get('key') || 0;
        if (op > 0) { ctx.fillStyle = `rgba(34, 211, 238, ${op})`; ctx.font = '26px Arial'; ctx.textAlign = 'center'; ctx.fillText('🔑', level.key.x, level.key.y); visibilityMap.current.set('key', op - 0.005); }
        if (Math.hypot(playerPos.current.x - level.key.x, playerPos.current.y - level.key.y) < 28 + PLAYER_RADIUS/2) { setHasKey(true); playSound(900, 'triangle', 0.4, 0.2); }
      }
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(level.end.x, level.end.y, 38, 0, Math.PI * 2); ctx.stroke();
      if (hasKey && Math.hypot(playerPos.current.x - level.end.x, playerPos.current.y - level.end.y) < 38 + PLAYER_RADIUS/2) winLevel();

      // 6. Avatar
      ctx.save(); ctx.beginPath(); ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2); ctx.clip();
      const img = new Image(); img.src = profile.avatar;
      ctx.drawImage(img, playerPos.current.x - PLAYER_RADIUS, playerPos.current.y - PLAYER_RADIUS, PLAYER_RADIUS*2, PLAYER_RADIUS*2);
      ctx.restore();

      animationFrame = requestAnimationFrame(render);
    };

    const handleCollision = () => {
      setLives(prev => {
        const next = prev - 1;
        if (next <= 0) {
          setGameState('RESPAWN');
          setRespawnTimeLeft(RESPAWN_TIMER);
          setLivesBoughtInSession(0);
          startRespawnTimer();
          return 0;
        } else {
          // Sonido Especial Choque
          playSound(150, 'square', 0.3, 0.2);
          playSound(80, 'sine', 0.4, 0.2);
          
          playerPos.current = { ...level.start };
          visibilityMap.current.clear();
          projectiles.current = [];
          pulses.current = [];
          isDragging.current = false;
          return next;
        }
      });
    };

    const winLevel = () => {
      const next = currentLevel + 1;
      setCurrentLevel(next);
      setMaxLevelReached(v => Math.max(v, next));
      setTotalScore(v => v + 1000);
      setHasKey(false);
      visibilityMap.current.clear();
      projectiles.current = [];
      playerPos.current = { ...levelData[next].start };
      playSound(1200, 'sine', 0.5, 0.2);
      saveGameState({ currentLevel: next, totalScore: totalScore + 1000 });
    };

    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      canvas.removeEventListener('mousedown', handleInputDown);
      canvas.removeEventListener('touchstart', handleInputDown);
      window.removeEventListener('mousemove', handleInputMove);
      window.removeEventListener('touchmove', handleInputMove);
      window.removeEventListener('mouseup', handleInputUp);
      window.addEventListener('touchend', handleInputUp);
    };
  }, [gameState, currentLevel, hasKey, echoes, profile.avatar, isMuted]);

  // --- RESPAWN TIMER ---
  const startRespawnTimer = () => {
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    respawnTimerRef.current = setInterval(() => {
      setRespawnTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(respawnTimerRef.current);
          restartFromLevel1(); 
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const currentRespawnPrice = useMemo(() => {
    return Math.max(1, INITIAL_RESPAWN_PRICE - livesBoughtInSession);
  }, [livesBoughtInSession]);

  const buyLife = () => {
    if (coins >= currentRespawnPrice) {
      setCoins(v => v - currentRespawnPrice);
      setLives(v => v + 1);
      setLivesBoughtInSession(v => v + 1);
      playSound(700, 'sine', 0.2, 0.2);
    }
  };

  const continueAfterRespawn = () => {
    if (lives > 0) {
      if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
      setGameState('PLAYING');
      setLivesBoughtInSession(0);
      playerPos.current = { ...levelData[currentLevel].start };
      visibilityMap.current.clear();
      projectiles.current = [];
    }
  };

  const restartFromLevel1 = () => {
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    setCurrentLevel(0); setLives(INITIAL_LIVES); setEchoes(INITIAL_ECHOES); setHasKey(false);
    playerPos.current = { ...levelData[0].start }; visibilityMap.current.clear();
    projectiles.current = []; setGameState('PLAYING');
    saveGameState({ currentLevel: 0, lives: INITIAL_LIVES, echoes: INITIAL_ECHOES });
  };

  if (gameState === 'LOADING') return <div className="h-screen bg-slate-950 flex items-center justify-center text-cyan-400 font-black tracking-widest uppercase text-white">Cargando...</div>;

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden text-white">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] w-full max-w-md text-center backdrop-blur-xl">
          <h2 className="text-3xl font-black italic mb-6 uppercase tracking-tighter">Tu Piloto</h2>
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <img src={profile.avatar} className="w-24 h-24 rounded-full border-4 border-cyan-500 object-cover" alt="Avatar" />
              <button onClick={() => fileInputRef.current.click()} className="absolute bottom-0 right-0 bg-cyan-500 p-2 rounded-full border-2 border-slate-900 text-slate-900">📷</button>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
            </div>
            <div className="flex gap-2 pb-2 overflow-x-auto w-full justify-center">
              {DEFAULT_AVATARS.map((av, i) => (
                <button key={i} onClick={() => setProfile({ ...profile, avatar: av })} className="w-10 h-10 rounded-full border-2 border-slate-700 overflow-hidden flex-shrink-0 hover:border-cyan-500 transition-colors"><img src={av} alt="cartoon" /></button>
              ))}
            </div>
            <input 
              type="text" placeholder="Nombre..." className="w-full p-4 bg-slate-950 rounded-xl border border-slate-800 text-white font-bold text-center focus:border-cyan-500 outline-none"
              value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
            <button onClick={saveProfile} className="w-full py-4 bg-cyan-500 text-slate-950 font-black rounded-xl hover:scale-105 transition-all shadow-lg uppercase tracking-widest">Registrarse</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden touch-none">
      
      {/* HUD SUPERIOR */}
      <div className="w-full max-w-[600px] mb-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
             <img src={profile.avatar} className="w-12 h-12 rounded-full border-2 border-cyan-500 shadow-lg shadow-cyan-500/20" alt="p" />
             <div className="hidden sm:block">
               <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">Piloto</div>
               <div className="font-bold text-sm leading-none">{profile.name}</div>
             </div>
          </div>
          <h1 className="text-2xl font-black italic tracking-tighter uppercase leading-none text-white">SANDECO <span className="text-cyan-400">BALL</span> ⚪</h1>
          <div className="flex gap-2">
            <button onClick={() => setIsMuted(!isMuted)} className="p-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 transition-colors">
               {isMuted ? '🔇' : '🔊'}
            </button>
            <button onClick={toggleFullscreen} className="p-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 transition-colors">
               {isFullscreen ? '⤓' : '⤢'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <StatBox label="NIVEL" value={currentLevel + 1} />
          <StatBox label="VIDAS" value={lives} color={lives < 3 ? 'text-red-500' : 'text-white'} />
          <StatBox label="ECOS" value={echoes} color="text-cyan-400" />
          <StatBox label="COINS" value={coins} color="text-amber-400" />
          <StatBox label="PUNTOS" value={totalScore} color="text-emerald-400" />
        </div>
      </div>

      <div className="relative rounded-[2rem] overflow-hidden border-4 border-slate-800 shadow-2xl bg-black">
        <canvas 
          ref={canvasRef} 
          width={CANVAS_SIZE} 
          height={CANVAS_SIZE} 
          className="w-full aspect-square max-w-[600px] touch-none cursor-crosshair" 
        />

        {/* MENÚ PRINCIPAL (PANTALLA INICIAL) */}
        {gameState === 'START' && (
          <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-sm">
            <h1 className="text-5xl font-black italic tracking-tighter mb-2 uppercase text-white">SANDECO BALL</h1>
            <p className="text-slate-500 mb-8 max-w-sm text-sm font-medium uppercase tracking-tight">Sobrevive a las flechas y enemigos zigzag. <br/> El eco revela tu destino.</p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button onClick={() => setGameState('PLAYING')} className="py-5 bg-cyan-500 text-slate-950 font-black rounded-3xl text-xl hover:scale-105 transition-all shadow-xl shadow-cyan-500/30 uppercase tracking-widest">Jugar</button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setGameState('RANKING')} className="py-3 bg-slate-900 border border-slate-800 rounded-xl font-bold text-xs uppercase tracking-widest text-white hover:bg-slate-800">Ranking</button>
                <button onClick={() => setGameState('STORE')} className="py-3 bg-slate-900 border border-slate-800 rounded-xl font-bold text-xs uppercase tracking-widest text-white hover:bg-slate-800">Tienda</button>
              </div>
            </div>
            <div className="mt-8 flex items-center gap-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-800">
               <img src={profile.avatar} className="w-10 h-10 rounded-full border border-cyan-500" />
               <span className="font-bold text-slate-300 text-sm">{profile.name}</span>
            </div>
          </div>
        )}

        {/* PANTALLA DE MUERTE */}
        {gameState === 'RESPAWN' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-8 text-center backdrop-blur-xl">
            <div className="text-7xl mb-4 text-white drop-shadow-[0_0_20px_rgba(239,68,68,0.5)]">💀</div>
            <h2 className="text-3xl font-black italic text-white mb-2 uppercase tracking-tighter">SIN ENERGÍA</h2>
            <div className="text-6xl font-black text-cyan-400 mb-4 tabular-nums animate-pulse">{respawnTimeLeft}s</div>
            
            <div className="mb-6 bg-slate-900/50 p-3 rounded-2xl border border-slate-800 text-white flex items-center gap-3">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Reservas:</span>
               <span className="text-xl font-black text-red-500 leading-none">{lives} ❤️</span>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button 
                onClick={buyLife} 
                disabled={coins < currentRespawnPrice} 
                className={`py-4 rounded-xl font-black text-lg transition-all shadow-lg ${coins >= currentRespawnPrice ? 'bg-amber-500 text-slate-950 hover:scale-105 active:scale-95' : 'bg-slate-800 text-slate-600'}`}
              >
                {coins >= currentRespawnPrice ? `+1 VIDA (${currentRespawnPrice} 🪙)` : `FALTAN ${currentRespawnPrice - coins} 🪙`}
              </button>
              <button 
                onClick={continueAfterRespawn} 
                disabled={lives === 0}
                className={`py-4 font-black rounded-xl text-lg uppercase tracking-widest shadow-md transition-all ${lives > 0 ? 'bg-cyan-500 text-slate-950 hover:scale-105' : 'bg-slate-800 text-slate-600 opacity-50 cursor-not-allowed'}`}
              >
                Continuar Nivel
              </button>
              <button onClick={restartFromLevel1} className="py-3 bg-white text-slate-900 font-black rounded-xl text-sm uppercase tracking-widest hover:bg-slate-100">Reiniciar Nivel 1</button>
              <button onClick={handleExitToMenu} className="py-3 bg-red-600/10 text-red-500 border border-red-500/30 font-black rounded-xl text-sm uppercase tracking-widest hover:bg-red-600/20">Menú Principal</button>
            </div>
          </div>
        )}

        {/* RANKING */}
        {gameState === 'RANKING' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl text-white">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-black italic tracking-tighter uppercase text-white">Líderes</h2>
                <button onClick={() => setGameState('START')} className="p-2 bg-slate-800 rounded-xl text-white font-bold hover:bg-slate-700">✕</button>
             </div>
             <div className="space-y-2 overflow-y-auto pr-2 flex-1 scrollbar-hide">
                {leaderboard.map((p, i) => (
                  <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${p.uid === user?.uid ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-slate-900/50 border-slate-800'}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-5 font-black text-slate-600 text-xs">{i + 1}</span>
                      <img src={p.avatar} className="w-8 h-8 rounded-full border border-slate-700" />
                      <div><div className="font-bold text-sm text-white leading-none">{p.name}</div><div className="text-[10px] text-slate-500 uppercase font-black">Nivel {p.level}</div></div>
                    </div>
                    <div className="text-cyan-400 font-black text-sm">{p.score}</div>
                  </div>
                ))}
             </div>
          </div>
        )}

        {/* TIENDA */}
        {gameState === 'STORE' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl text-white">
             <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-black italic tracking-tighter uppercase text-white">Almacén</h2>
                <button onClick={() => setGameState('START')} className="p-2 bg-slate-800 rounded-xl text-white font-bold hover:bg-slate-700">✕</button>
             </div>
             <div className="space-y-4">
               <StoreItem title="Bolsa de 15 Ecos" price="10 🪙" onBuy={() => { if(coins >= 10) { setCoins(v=>v-10); setEchoes(v=>v+15); } }} />
               <StoreItem title="Vida Extra" price="25 🪙" onBuy={() => { if(coins >= 25) { setCoins(v=>v-25); setLives(v=>Math.min(v+1, 15)); } }} />
               <StoreItem title="Célula de Energía (50 Ecos)" price="30 🪙" onBuy={() => { if(coins >= 30) { setCoins(v=>v-30); setEchoes(v=>v+50); } }} />
             </div>
          </div>
        )}
      </div>

      {/* BOTÓN GUARDAR Y SALIR (ACTIVO DURANTE EL JUEGO) */}
      <div className="mt-4 w-full max-w-[600px] flex gap-2">
        {gameState === 'PLAYING' && (
          <button 
            onClick={handleExitToMenu}
            className="w-full py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase tracking-[0.2em] text-slate-500 hover:text-white transition-all shadow-xl hover:bg-slate-800"
          >
            ← Guardar y Salir
          </button>
        )}
      </div>
      
      {gameState === 'PLAYING' && (
        <p className="mt-3 text-[10px] text-slate-600 font-black uppercase tracking-[0.5em] animate-pulse text-white">Arrastra el Piloto • Pulsa para Eco</p>
      )}
    </div>
  );
};

const StatBox = ({ label, value, color = "text-white" }) => (
  <div className="bg-slate-900/95 p-2 rounded-xl border border-slate-800 text-center shadow-inner">
    <div className="text-[7px] sm:text-[9px] text-slate-600 font-black uppercase tracking-widest mb-1 leading-none">{label}</div>
    <div className={`text-xs sm:text-base font-black ${color} tracking-tighter leading-none`}>{value}</div>
  </div>
);

const StoreItem = ({ title, price, onBuy }) => (
  <button onClick={onBuy} className="w-full flex justify-between items-center p-5 bg-slate-900 border border-slate-800 rounded-3xl hover:bg-slate-800 transition-all shadow-lg group">
    <div className="text-left">
        <div className="font-bold text-sm text-white group-hover:text-cyan-400 transition-colors">{title}</div>
        <div className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none">Equipamiento</div>
    </div>
    <span className="bg-amber-500 text-slate-900 px-4 py-2 rounded-xl font-black text-xs shadow-md group-active:scale-95 transition-transform">{price}</span>
  </button>
);

export default App;

