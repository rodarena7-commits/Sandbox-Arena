import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection,
  addDoc, query, orderBy, deleteDoc
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
const appId = 'sandeco-ball-v1';

// --- CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 18; 
const HITBOX_RELAX = 85;
const INITIAL_LIVES = 10; 
const INITIAL_ECHOES = 30;
const INITIAL_RESPAWN_PRICE = 10; 
const RESPAWN_TIMER = 30; 
const SHIELD_RADIUS = PLAYER_RADIUS * 1.5;
const SHIELD_POSITION = { x: 300, y: 300 };
const PORTAL_VISIBILITY_COST = 1; // Costo en ecos para revelar portal

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Felix",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Milo",
  "https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe"
];

// --- SISTEMA DE ACTUALIZACIONES PWA ---
const APP_VERSION = '1.1.0';

const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('SW registrado correctamente:', registration.scope);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if (window.confirm('¡Nueva versión disponible! ¿Quieres recargar para actualizar?')) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              }
            }
          });
        });
      })
      .catch(error => {
        console.error('Error registrando SW:', error);
      });
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('load', registerServiceWorker);
}

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
  const [customLevels, setCustomLevels] = useState([]);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('LOADING'); 
  const [gameMode, setGameMode] = useState('CAMPAIGN'); 
  const [currentLevel, setCurrentLevel] = useState(0);
  const [maxLevelReached, setMaxLevelReached] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Modo Creativo
  const [editorMode, setEditorMode] = useState('SELECT');
  const [editingLevel, setEditingLevel] = useState(null);
  const [levelName, setLevelName] = useState('');
  const [levelDescription, setLevelDescription] = useState('');
  
  // Recursos
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [echoes, setEchoes] = useState(INITIAL_ECHOES);
  const [coins, setCoins] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [respawnTimeLeft, setRespawnTimeLeft] = useState(RESPAWN_TIMER);
  const [livesBoughtInSession, setLivesBoughtInSession] = useState(0);
  
  // Campo de protección estático
  const [shieldActive, setShieldActive] = useState(true);
  const [isInShield, setIsInShield] = useState(true);

  // Motor Refs
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const projectiles = useRef([]);
  const lastProjectileSpawn = useRef(0);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const portalCooldown = useRef(0);
  const lastHitTime = useRef(0);
  const audioCtx = useRef(null);
  const masterGain = useRef(null);
  const respawnTimerRef = useRef(null);
  
  // Estado para portales revelados y usados
  const [revealedPortals, setRevealedPortals] = useState(new Set());
  const [usedPortals, setUsedPortals] = useState(new Set());
  
  // Editor Refs
  const editorObjects = useRef({
    walls: [],
    crosses: [],
    patrols: [],
    orbits: [],
    coins: [],
    hearts: [],
    echoPacks: [],
    portals: [],
    shield: { x: 300, y: 300, radius: SHIELD_RADIUS },
    start: { x: 70, y: 70 },
    end: { x: 530, y: 530 },
    key: { x: 400, y: 400 }
  });

  // --- PREVENCIÓN DE SCROLL ---
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  }, []);

  // --- LÓGICA PWA ---
  useEffect(() => {
    const handler = (e) => { 
      e.preventDefault(); 
      setInstallPrompt(e); 
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  // --- VERIFICAR Y FORZAR ACTUALIZACIONES ---
  useEffect(() => {
    const checkForUpdates = () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(registration => {
          if (registration) {
            registration.update();
          }
        });
      }
    };

    const updateInterval = setInterval(checkForUpdates, 30 * 60 * 1000);
    
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkForUpdates();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    const handleOnline = () => {
      checkForUpdates();
    };
    
    window.addEventListener('online', handleOnline);
    
    return () => {
      clearInterval(updateInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const clearAppCache = () => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
    }
    alert('Cache limpiado. La app se recargará.');
    window.location.reload();
  };

  // --- FIREBASE & CACHE ---
  useEffect(() => {
    const cached = localStorage.getItem('sandeco_ball_profile');
    if (cached) setProfile(JSON.parse(cached));
    
    const initAuth = async () => { 
      try { 
        await signInAnonymously(auth); 
      } catch (e) { 
        setGameState('START'); 
      } 
    };
    
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Perfil
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        localStorage.setItem('sandeco_ball_profile', JSON.stringify(data));
        setIsProfileSet(true);
        setGameState('START');
      } else if (!localStorage.getItem('sandeco_ball_profile')) {
        setGameState('SETUP');
      } else {
        setIsProfileSet(true);
        setGameState('START');
      }
    });

    // Estadísticas
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(statsRef).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setMaxLevelReached(d.maxLevel || 0);
        setCurrentLevel(d.currentLevel || 0);
        setCoins(d.coins || 0);
        setTotalScore(d.totalScore || 0);
        setLives(d.lives || INITIAL_LIVES);
        setEchoes(d.echoes || INITIAL_ECHOES);
      }
    });

    // Leaderboard
    const rankingRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubRank = onSnapshot(rankingRef, (snap) => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => b.score - a.score);
      setLeaderboard(docs);
    });

    // Niveles personalizados
    const customLevelsRef = collection(db, 'artifacts', appId, 'public', 'data', 'customLevels');
    const q = query(customLevelsRef, orderBy('createdAt', 'desc'));
    const unsubLevels = onSnapshot(q, (snap) => {
      const levels = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomLevels(levels);
    });
    
    return () => {
      unsubRank();
      unsubLevels();
    };
  }, [user]);

  // --- GENERADOR DE NIVELES PROGRESIVOS ---
  const levelData = useMemo(() => {
    const generateLevel = (index, mode) => {
      const isCampaign = mode === 'CAMPAIGN';
      let seed = isCampaign ? index * 147.2 : Math.random() * 1000000;
      const rnd = () => { seed += 1.1; return seededRandom(seed); };

      // Dificultad progresiva
      const difficulty = index / 100;
      const easyMode = index < 20;
      const mediumMode = index >= 20 && index < 50;
      const hardMode = index >= 50;

      // Paredes básicas
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

      // Paredes internas
      let wallCount = 0;
      if (easyMode) {
        wallCount = 3 + Math.floor(rnd() * 4);
      } else if (mediumMode) {
        wallCount = 6 + Math.floor(rnd() * 6);
      } else {
        wallCount = 8 + Math.floor(rnd() * 8);
      }

      for (let j = 0; j < wallCount; j++) {
        const w = 40 + rnd() * 60;
        const h = 40 + rnd() * 60;
        walls.push({ 
          x: 100 + rnd() * (CANVAS_SIZE - 200 - w), 
          y: 100 + rnd() * (CANVAS_SIZE - 200 - h), 
          w, h, 
          id: `w-${index}-${j}` 
        });
      }

      // Elementos especiales
      const campaignFeatures = { crosses: [], patrols: [], orbits: [] };
      
      if (isCampaign) {
        // Cruces rotatorias TRIPLES (3x más grandes y 3x más lentas)
        if (index >= 10) {
          const crossCount = easyMode ? 1 : mediumMode ? 2 : 3;
          for (let j = 0; j < crossCount; j++) {
            campaignFeatures.crosses.push({ 
              ...getSafePos(100, 150),
              size: 90 + rnd() * 60,
              angle: rnd() * Math.PI * 2,
              speed: (easyMode ? 0.003 : mediumMode ? 0.004 : 0.005),
              id: `cr-${index}-${j}` 
            });
          }
        }

        // Patrullas
        if (index >= 5) {
          const patrolCount = easyMode ? 1 : mediumMode ? 2 : 3;
          for (let j = 0; j < patrolCount; j++) {
            campaignFeatures.patrols.push({ 
              x: 120 + rnd() * 360, 
              y: 120 + rnd() * 360, 
              w: 35, h: 35, 
              vx: rnd() > 0.5 ? (easyMode ? 2 : mediumMode ? 3 : 4) : 0, 
              vy: rnd() > 0.5 ? 0 : (easyMode ? 2 : mediumMode ? 3 : 4), 
              id: `pa-${index}-${j}` 
            });
          }
        }

        // Órbitas
        if (index >= 20) {
          const orbitCount = mediumMode ? 1 : 2;
          for (let j = 0; j < orbitCount; j++) {
            campaignFeatures.orbits.push({ 
              cx: 150 + rnd() * 300, 
              cy: 150 + rnd() * 300, 
              radius: 100 + rnd() * 160, 
              angle: rnd() * Math.PI, 
              speed: easyMode ? 0.01 : mediumMode ? 0.015 : 0.02,
              size: 24, 
              id: `ob-${index}-${j}` 
            });
          }
        }
      }

      // Muros móviles
      const movingWalls = [];
      if (!isCampaign || index > 2) {
        let movingWallCount = 0;
        if (easyMode) {
          movingWallCount = 1 + Math.floor(rnd() * 2);
        } else if (mediumMode) {
          movingWallCount = 2 + Math.floor(rnd() * 3);
        } else {
          movingWallCount = 3 + Math.floor(rnd() * 4);
        }

        for (let j = 0; j < movingWallCount; j++) {
          const speedBase = easyMode ? 4 : mediumMode ? 6 : 8;
          movingWalls.push({ 
            x: 150 + rnd() * 300, 
            y: 150 + rnd() * 300, 
            w: 25, h: 25, 
            vx: (rnd() - 0.5) * speedBase, 
            vy: (rnd() - 0.5) * speedBase, 
            id: `m-${index}-${j}` 
          });
        }
      }

      // UN SOLO PORTAL EN EXTREMOS OPUESTOS (alejados)
      const portals = [];
      
      // Determinar extremos opuestos aleatorios pero siempre lejos
      const sideA = Math.floor(rnd() * 4); // 0: arriba, 1: derecha, 2: abajo, 3: izquierda
      const sideB = (sideA + 2) % 4; // Extremo opuesto
      
      let portalA, portalB;
      
      // Posicionar portal A en un extremo
      switch(sideA) {
        case 0: // Arriba
          portalA = { x: 100 + rnd() * (CANVAS_SIZE - 200), y: 80 };
          break;
        case 1: // Derecha
          portalA = { x: CANVAS_SIZE - 80, y: 100 + rnd() * (CANVAS_SIZE - 200) };
          break;
        case 2: // Abajo
          portalA = { x: 100 + rnd() * (CANVAS_SIZE - 200), y: CANVAS_SIZE - 80 };
          break;
        case 3: // Izquierda
          portalA = { x: 80, y: 100 + rnd() * (CANVAS_SIZE - 200) };
          break;
      }
      
      // Posicionar portal B en el extremo opuesto
      switch(sideB) {
        case 0: // Arriba
          portalB = { x: 100 + rnd() * (CANVAS_SIZE - 200), y: 80 };
          break;
        case 1: // Derecha
          portalB = { x: CANVAS_SIZE - 80, y: 100 + rnd() * (CANVAS_SIZE - 200) };
          break;
        case 2: // Abajo
          portalB = { x: 100 + rnd() * (CANVAS_SIZE - 200), y: CANVAS_SIZE - 80 };
          break;
        case 3: // Izquierda
          portalB = { x: 80, y: 100 + rnd() * (CANVAS_SIZE - 200) };
          break;
      }
      
      // Asegurar que estén en posiciones seguras
      if (!isSafe(portalA.x, portalA.y, 35)) portalA = getSafePos(35, 80);
      if (!isSafe(portalB.x, portalB.y, 35)) portalB = getSafePos(35, 80);
      
      // Forzar que estén realmente alejados (mínimo 400px de distancia)
      let attempts = 0;
      while (Math.hypot(portalA.x - portalB.x, portalA.y - portalB.y) < 400 && attempts < 50) {
        portalB = getSafePos(35, 80);
        attempts++;
      }
      
      portals.push({ 
        a: portalA, 
        b: portalB, 
        id: `portal-${index}`,
        revealed: false, // Inicialmente no revelado
        used: false
      });

      // Monedas
      const coinCount = easyMode ? 6 : mediumMode ? 5 : 4;
      const coins = Array.from({ length: coinCount }, (_, j) => ({ 
        ...getSafePos(15, 80), 
        id: `c-${index}-${j}`, 
        collected: false 
      }));

      // Corazones
      const hearts = [];
      if (rnd() > 0.6 || index % 10 === 0) {
        hearts.push({ ...getSafePos(20, 80), id: `h-${index}`, collected: false });
      }

      // Paquetes de ecos
      const echoPacks = [];
      if (rnd() > 0.7 || index % 8 === 0) {
        echoPacks.push({ ...getSafePos(20, 80), id: `e-${index}`, collected: false });
      }

      // Campo de protección estático
      const shieldPos = getSafePos(SHIELD_RADIUS, 100);

      return {
        id: index, 
        walls, 
        movingWalls, 
        ...campaignFeatures,
        portals,
        coins,
        hearts,
        echoPacks,
        shield: shieldPos,
        start: { x: 70, y: 70 }, 
        end: { x: 530, y: 530 }, 
        key: getSafePos(25, 160),
        projectileSpeed: easyMode ? 3 : mediumMode ? 4 : 5,
        projectileSpawnRate: Math.max(350, 2500 - index * 20),
        difficulty: easyMode ? 'FÁCIL' : mediumMode ? 'MEDIO' : 'DIFÍCIL'
      };
    };

    return {
      campaign: Array.from({ length: 100 }, (_, i) => generateLevel(i, 'CAMPAIGN')),
      random: Array.from({ length: 100 }, (_, i) => generateLevel(i, 'RANDOM'))
    };
  }, []);

  // Función para crear nivel desde editor
  const createLevelFromEditor = () => {
    const objects = editorObjects.current;
    return {
      id: Date.now(),
      walls: objects.walls,
      movingWalls: [],
      crosses: objects.crosses,
      patrols: objects.patrols,
      orbits: objects.orbits,
      portals: objects.portals.map((p, i) => ({ 
        a: p.a, 
        b: p.b, 
        id: `portal-custom-${i}`,
        revealed: false,
        used: false
      })),
      coins: objects.coins.map(c => ({ ...c, collected: false })),
      hearts: objects.hearts.map(h => ({ ...h, collected: false })),
      echoPacks: objects.echoPacks.map(e => ({ ...e, collected: false })),
      shield: objects.shield,
      start: objects.start,
      end: objects.end,
      key: objects.key,
      projectileSpeed: 4,
      projectileSpawnRate: 1500,
      difficulty: 'PERSONALIZADO',
      custom: true,
      name: levelName,
      description: levelDescription,
      creator: profile.name,
      creatorId: user?.uid
    };
  };

  const currentLevelData = useMemo(() => {
    if (gameMode === 'CREATIVE' && editingLevel) {
      return editingLevel;
    }
    return gameMode === 'CAMPAIGN' ? levelData.campaign[currentLevel] : levelData.random[currentLevel];
  }, [gameMode, currentLevel, levelData, editingLevel]);

  // --- LÓGICA DE JUEGO ---
  const saveGameState = async (override = {}) => {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    const data = { 
      maxLevel: Math.max(maxLevelReached, currentLevel), 
      currentLevel, 
      coins, 
      totalScore, 
      lives, 
      echoes, 
      gameMode, 
      ...override 
    };
    await setDoc(statsRef, data, { merge: true });
    await setDoc(leadRef, { 
      name: profile.name, 
      avatar: profile.avatar, 
      score: totalScore, 
      level: currentLevel + 1, 
      uid: user.uid 
    }, { merge: true });
  };

  const saveCustomLevel = async () => {
    if (!user || !levelName.trim()) return;
    
    const levelData = createLevelFromEditor();
    const customLevelsRef = collection(db, 'artifacts', appId, 'public', 'data', 'customLevels');
    
    try {
      await addDoc(customLevelsRef, {
        ...levelData,
        createdAt: new Date(),
        likes: 0,
        plays: 0
      });
      alert('¡Nivel guardado exitosamente!');
      setLevelName('');
      setLevelDescription('');
      setEditorMode('SELECT');
    } catch (error) {
      console.error('Error guardando nivel:', error);
      alert('Error al guardar el nivel');
    }
  };

  const deleteCustomLevel = async (levelId) => {
    if (!window.confirm('¿Eliminar este nivel?')) return;
    
    try {
      const levelRef = doc(db, 'artifacts', appId, 'public', 'data', 'customLevels', levelId);
      await deleteDoc(levelRef);
    } catch (error) {
      console.error('Error eliminando nivel:', error);
    }
  };

  const handleExitToMenu = async () => { 
    await saveGameState(); 
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current); 
    setGameState('START'); 
    setEditingLevel(null);
    setRevealedPortals(new Set());
    setUsedPortals(new Set());
  };

  const saveProfile = async () => { 
    if (!profile.name.trim() || !user) return; 
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'); 
    await setDoc(profileRef, profile); 
    localStorage.setItem('sandeco_ball_profile', JSON.stringify(profile)); 
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

  // Sincronización inicial
  useEffect(() => {
    if (gameState === 'PLAYING') {
      playerPos.current = { ...currentLevelData.start };
      pulses.current = [];
      projectiles.current = [];
      visibilityMap.current.clear();
      isDragging.current = false;
      lastHitTime.current = 0;
      setHasKey(false);
      portalCooldown.current = 0;
      setRevealedPortals(new Set());
      setUsedPortals(new Set());
      
      // Siempre empezar visible dentro del campo de protección
      setIsInShield(true);
      visibilityMap.current.set('shield', 1);
    }
  }, [currentLevel, gameMode, gameState]);

  // --- EDITOR DE NIVELES ---
  const handleEditorClick = (e) => {
    if (gameMode !== 'CREATIVE' || gameState !== 'PLAYING') return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);
    
    switch (editorMode) {
      case 'WALL':
        editorObjects.current.walls.push({ x, y, w: 60, h: 60, id: `wall-${Date.now()}` });
        break;
      case 'ENEMY':
        editorObjects.current.crosses.push({ 
          x, y, 
          size: 90, 
          angle: 0, 
          speed: 0.003, 
          id: `cross-${Date.now()}` 
        });
        break;
      case 'PATROL':
        editorObjects.current.patrols.push({ 
          x, y, 
          w: 35, h: 35, 
          vx: 3, vy: 0, 
          id: `patrol-${Date.now()}` 
        });
        break;
      case 'PORTAL':
        if (editorObjects.current.portals.length % 2 === 0) {
          editorObjects.current.portals.push({ a: { x, y }, b: null });
        } else {
          const lastPortal = editorObjects.current.portals[editorObjects.current.portals.length - 1];
          lastPortal.b = { x, y };
        }
        break;
      case 'ITEM':
        editorObjects.current.coins.push({ x, y, id: `coin-${Date.now()}` });
        break;
      case 'HEART':
        editorObjects.current.hearts.push({ x, y, id: `heart-${Date.now()}` });
        break;
      case 'ECHO':
        editorObjects.current.echoPacks.push({ x, y, id: `echo-${Date.now()}` });
        break;
      case 'START':
        editorObjects.current.start = { x, y };
        break;
      case 'END':
        editorObjects.current.end = { x, y };
        break;
      case 'KEY':
        editorObjects.current.key = { x, y };
        break;
      case 'SHIELD':
        editorObjects.current.shield = { x, y, radius: SHIELD_RADIUS };
        break;
      case 'DELETE':
        const allObjects = [
          ...editorObjects.current.walls.map(w => ({ ...w, type: 'WALL' })),
          ...editorObjects.current.crosses.map(c => ({ ...c, type: 'CROSS' })),
          ...editorObjects.current.patrols.map(p => ({ ...p, type: 'PATROL' })),
          ...editorObjects.current.coins.map(c => ({ ...c, type: 'COIN' })),
          ...editorObjects.current.hearts.map(h => ({ ...h, type: 'HEART' })),
          ...editorObjects.current.echoPacks.map(e => ({ ...e, type: 'ECHO' })),
          { ...editorObjects.current.start, type: 'START' },
          { ...editorObjects.current.end, type: 'END' },
          { ...editorObjects.current.key, type: 'KEY' },
          { ...editorObjects.current.shield, type: 'SHIELD' }
        ];
        
        const closest = allObjects.reduce((closest, obj) => {
          const dist = Math.hypot(x - obj.x, y - (obj.y || 0));
          if (dist < 30 && dist < closest.dist) {
            return { obj, dist };
          }
          return closest;
        }, { obj: null, dist: Infinity });
        
        if (closest.obj) {
          switch (closest.obj.type) {
            case 'WALL':
              editorObjects.current.walls = editorObjects.current.walls.filter(w => w.id !== closest.obj.id);
              break;
            case 'CROSS':
              editorObjects.current.crosses = editorObjects.current.crosses.filter(c => c.id !== closest.obj.id);
              break;
            case 'PATROL':
              editorObjects.current.patrols = editorObjects.current.patrols.filter(p => p.id !== closest.obj.id);
              break;
            case 'COIN':
              editorObjects.current.coins = editorObjects.current.coins.filter(c => c.id !== closest.obj.id);
              break;
            case 'HEART':
              editorObjects.current.hearts = editorObjects.current.hearts.filter(h => h.id !== closest.obj.id);
              break;
            case 'ECHO':
              editorObjects.current.echoPacks = editorObjects.current.echoPacks.filter(e => e.id !== closest.obj.id);
              break;
            case 'START':
              editorObjects.current.start = { x: 70, y: 70 };
              break;
            case 'END':
              editorObjects.current.end = { x: 530, y: 530 };
              break;
            case 'KEY':
              editorObjects.current.key = { x: 400, y: 400 };
              break;
            case 'SHIELD':
              editorObjects.current.shield = { x: 300, y: 300, radius: SHIELD_RADIUS };
              break;
          }
        }
        break;
    }
  };

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
      if (gameMode === 'CREATIVE') {
        handleEditorClick(e);
        return;
      }
      
      const pos = getPos(e);
      const dist = Math.hypot(pos.x - playerPos.current.x, pos.y - playerPos.current.y);
      
      if (dist < HITBOX_RELAX) {
        isDragging.current = true;
      } else {
        if (echoes > 0) {
          // Crear pulso de eco
          pulses.current.push({ x: pos.x, y: pos.y, r: 0, maxR: 450, alpha: 1 });
          setEchoes(v => v - 1);
          playSound(440, 'sine', 0.2, 0.05);
          
          // Revelar portales si están cerca del pulso
          level.portals?.forEach(portal => {
            const distA = Math.hypot(pos.x - portal.a.x, pos.y - portal.a.y);
            const distB = Math.hypot(pos.x - portal.b.x, pos.y - portal.b.y);
            
            if ((distA < 200 || distB < 200) && !revealedPortals.has(portal.id) && !usedPortals.has(portal.id)) {
              // Gastar eco extra para revelar portal
              if (echoes - 1 >= 0) {
                setEchoes(v => v - 1);
                setRevealedPortals(prev => new Set(prev).add(portal.id));
                playSound(600, 'sine', 0.3, 0.2);
              }
            }
          });
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
      
      const shieldX = level.shield?.x || SHIELD_POSITION.x;
      const shieldY = level.shield?.y || SHIELD_POSITION.y;
      const inShield = Math.hypot(playerPos.current.x - shieldX, playerPos.current.y - shieldY) < SHIELD_RADIUS;
      
      if (inShield !== isInShield) {
        setIsInShield(inShield);
        if (inShield) {
          playSound(600, 'sine', 0.3, 0.1);
        }
      }
    };

    const handleInputUp = () => { isDragging.current = false; };

    canvas.addEventListener('mousedown', handleInputDown);
    canvas.addEventListener('touchstart', handleInputDown, { passive: false });
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('touchmove', handleInputMove, { passive: false });
    window.addEventListener('mouseup', handleInputUp);
    window.addEventListener('touchend', handleInputUp);

    const handleCollision = () => {
      if (isInShield) {
        playSound(300, 'square', 0.2, 0.1);
        return;
      }
      
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
          setIsInShield(true);
          visibilityMap.current.set('shield', 1);
          return next; 
        }
      });
    };

    const render = (time) => {
      ctx.fillStyle = '#01050a'; 
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (gameMode !== 'CREATIVE' && time - lastProjectileSpawn.current > level.projectileSpawnRate) {
        const side = Math.floor(Math.random() * 4);
        let x, y, vx, vy;
        
        if (side === 0) { 
          x = Math.random() * CANVAS_SIZE; 
          y = -30; 
          vx = (Math.random() - 0.5) * 1;
          vy = level.projectileSpeed; 
        } else if (side === 1) { 
          x = CANVAS_SIZE + 30; 
          y = Math.random() * CANVAS_SIZE; 
          vx = -level.projectileSpeed; 
          vy = (Math.random() - 0.5) * 1;
        } else if (side === 2) { 
          x = Math.random() * CANVAS_SIZE; 
          y = CANVAS_SIZE + 30; 
          vx = (Math.random() - 0.5) * 1;
          vy = -level.projectileSpeed; 
        } else { 
          x = -30; 
          y = Math.random() * CANVAS_SIZE; 
          vx = level.projectileSpeed; 
          vy = (Math.random() - 0.5) * 1;
        }
        
        projectiles.current.push({ x, y, vx, vy, id: Math.random() });
        lastProjectileSpawn.current = time;
      }

      // Ecos
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 10; 
        p.alpha *= 0.96; 
        
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); 
        ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`; 
        ctx.lineWidth = 2; 
        ctx.stroke();
        
        const reveal = (o, isC = false) => {
          let d = isC ? Math.hypot(p.x - o.x, p.y - o.y) : 
                     Math.hypot(p.x - Math.max(o.x, Math.min(p.x, o.x + o.w)), 
                               p.y - Math.max(o.y, Math.min(p.y, o.y + o.h)));
          if (Math.abs(d - p.r) < 45) visibilityMap.current.set(o.id || 'key', 1);
        };
        
        level.walls?.forEach(w => reveal(w)); 
        level.movingWalls?.forEach(m => reveal(m));
        level.crosses?.forEach(c => reveal(c, true)); 
        level.patrols?.forEach(pt => reveal(pt));
        level.orbits?.forEach(ob => reveal(ob, true));
        level.coins?.forEach(c => reveal(c, true)); 
        level.hearts?.forEach(h => reveal(h, true));
        level.echoPacks?.forEach(e => reveal(e, true));
        level.portals?.forEach(p => {
          reveal(p.a, true); 
          reveal(p.b, true);
        });
        reveal(level.key, true);
        reveal(level.shield || SHIELD_POSITION, true);
      });

      // Muros estáticos
      level.walls?.forEach(w => {
        const op = visibilityMap.current.get(w.id) || 0;
        if (op > 0) { 
          ctx.fillStyle = `rgba(34, 211, 238, ${op})`; 
          ctx.fillRect(w.x, w.y, w.w, w.h); 
          visibilityMap.current.set(w.id, op - 0.01); 
        }
        
        if (gameMode !== 'CREATIVE') {
          const cx = Math.max(w.x, Math.min(playerPos.current.x, w.x + w.w)); 
          const cy = Math.max(w.y, Math.min(playerPos.current.y, w.y + w.h));
          if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 2) handleCollision();
        }
      });

      // Cruces rotatorias
      level.crosses?.forEach(c => {
        c.angle += c.speed; 
        const op = visibilityMap.current.get(c.id) || 0;
        
        if (op > 0) {
          ctx.save(); 
          ctx.translate(c.x, c.y); 
          ctx.rotate(c.angle); 
          ctx.strokeStyle = `rgba(244, 63, 94, ${op})`; 
          ctx.lineWidth = 15;
          ctx.beginPath(); 
          ctx.moveTo(-c.size, 0); 
          ctx.lineTo(c.size, 0); 
          ctx.moveTo(0, -c.size); 
          ctx.lineTo(0, c.size); 
          ctx.stroke(); 
          ctx.restore();
          visibilityMap.current.set(c.id, op - 0.01);
        }
        
        if (gameMode !== 'CREATIVE' && Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < c.size + PLAYER_RADIUS) {
          const la = Math.atan2(playerPos.current.y - c.y, playerPos.current.x - c.x) - c.angle;
          const n = ((la % (Math.PI / 2)) + (Math.PI / 2)) % (Math.PI / 2);
          if (n < 0.22 || n > (Math.PI / 2 - 0.22)) handleCollision();
        }
      });

      // Patrullas
      level.patrols?.forEach(pt => {
        pt.x += pt.vx; 
        pt.y += pt.vy;
        
        if (pt.x < 20 || pt.x > CANVAS_SIZE - 20 - pt.w) pt.vx *= -1;
        if (pt.y < 20 || pt.y > CANVAS_SIZE - 20 - pt.h) pt.vy *= -1;
        
        const op = visibilityMap.current.get(pt.id) || 0;
        if (op > 0) { 
          ctx.fillStyle = `rgba(244, 63, 94, ${op})`; 
          ctx.fillRect(pt.x, pt.y, pt.w, pt.h); 
          visibilityMap.current.set(pt.id, op - 0.015); 
        }
        
        if (gameMode !== 'CREATIVE') {
          const cx = Math.max(pt.x, Math.min(playerPos.current.x, pt.x + pt.w)); 
          const cy = Math.max(pt.y, Math.min(playerPos.current.y, pt.y + pt.h));
          if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 1) handleCollision();
        }
      });

      // Órbitas
      level.orbits?.forEach(ob => {
        ob.angle += ob.speed;
        const ox = ob.cx + Math.cos(ob.angle) * ob.radius;
        const oy = ob.cy + Math.sin(ob.angle) * ob.radius;
        
        const op = visibilityMap.current.get(ob.id) || 0;
        if (op > 0) { 
          ctx.beginPath(); 
          ctx.arc(ox, oy, ob.size, 0, Math.PI * 2); 
          ctx.fillStyle = `rgba(244, 63, 94, ${op})`; 
          ctx.fill(); 
          visibilityMap.current.set(ob.id, op - 0.01); 
        }
        
        if (gameMode !== 'CREATIVE' && Math.hypot(playerPos.current.x - ox, playerPos.current.y - oy) < ob.size + PLAYER_RADIUS - 5) handleCollision();
      });

      // PORTALES - SOLO VISIBLES SI FUERON REVELADOS Y NO USADOS
      level.portals?.forEach(portal => {
        const portalRevealed = revealedPortals.has(portal.id);
        const portalUsed = usedPortals.has(portal.id);
        
        const drawPortal = (p, isPortalA) => {
          // SOLO DIBUJAR SI EL PORTAL FUE REVELADO Y NO HA SIDO USADO
          if (!portalRevealed || portalUsed) return;
          
          const time = Date.now() / 1000;
          const pulseIntensity = 0.8 + 0.2 * Math.sin(time * 3);
          const rotation = time % (Math.PI * 2);
          
          // Círculo exterior verde fluor brillante
          ctx.beginPath(); 
          ctx.arc(p.x, p.y, 30, 0, Math.PI * 2); 
          ctx.strokeStyle = `rgba(0, 255, 127, ${pulseIntensity})`;
          ctx.lineWidth = 6; 
          ctx.stroke();
          
          // Círculo interior más brillante
          ctx.beginPath();
          ctx.arc(p.x, p.y, 24, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0, 255, 127, ${pulseIntensity * 0.6})`;
          ctx.fill();
          
          // Efecto de partículas girando
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(rotation);
          
          const particleCount = 6;
          for (let i = 0; i < particleCount; i++) {
            const angle = (i * (Math.PI * 2) / particleCount) + rotation * 2;
            const px = Math.cos(angle) * 36;
            const py = Math.sin(angle) * 36;
            
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0, 255, 127, ${0.7 + 0.3 * Math.sin(time * 4 + i)})`;
            ctx.fill();
          }
          
          ctx.restore();
          
          // Efecto de aura exterior
          ctx.beginPath();
          ctx.arc(p.x, p.y, 36, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 255, 127, ${0.3 + 0.2 * Math.sin(time * 2)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          
          // Teletransportación al tocar el portal (solo si no ha sido usado)
          if (portalCooldown.current <= 0 && Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < 30 && !portalUsed) { 
            // Encontrar el portal pareado
            const target = isPortalA ? portal.b : portal.a;
            if (target) {
              // Teletransportar al portal opuesto
              playerPos.current = { ...target }; 
              portalCooldown.current = 60; 
              playSound(800, 'sine', 0.4, 0.2);
              
              // Marcar el portal como usado y desaparecer
              setUsedPortals(prev => new Set(prev).add(portal.id));
              
              // Efecto visual de teletransportación
              for (let i = 0; i < 20; i++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * 40;
                const px = p.x + Math.cos(angle) * distance;
                const py = p.y + Math.sin(angle) * distance;
                
                ctx.beginPath();
                ctx.arc(px, py, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0, 255, 127, 0.8)';
                ctx.fill();
              }
            }
          }
        };
        
        drawPortal(portal.a, true);
        drawPortal(portal.b, false);
      });
      
      if (portalCooldown.current > 0) portalCooldown.current--;

      // Flechas/proyectiles
      if (gameMode !== 'CREATIVE') {
        projectiles.current.forEach(p => {
          p.x += p.vx; 
          p.y += p.vy;
          
          ctx.fillStyle = '#f43f5e'; 
          ctx.beginPath(); 
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); 
          ctx.fill();
          
          if (Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < PLAYER_RADIUS + 6) handleCollision();
        });
        
        projectiles.current = projectiles.current.filter(p => p.x > -60 && p.x < 660 && p.y > -60 && p.y < 660);
      }

      // Monedas
      level.coins?.forEach(c => {
        if (c.collected) return; 
        const op = visibilityMap.current.get(c.id) || 0;
        
        if (op > 0) { 
          ctx.fillStyle = `rgba(251, 191, 36, ${op})`; 
          ctx.beginPath(); 
          ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); 
          ctx.fill(); 
          
          ctx.fillStyle = `rgba(255, 255, 255, ${op * 0.5})`;
          ctx.beginPath();
          ctx.arc(c.x - 3, c.y - 3, 3, 0, Math.PI * 2);
          ctx.fill();
          
          visibilityMap.current.set(c.id, op - 0.005); 
        }
        
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < 25) { 
          c.collected = true; 
          setCoins(v => v + 1); 
          setTotalScore(v => v + 50); 
          playSound(1000, 'sine', 0.1, 0.1); 
        }
      });

      // Corazones
      level.hearts?.forEach(h => {
        if (h.collected) return; 
        const op = visibilityMap.current.get(h.id) || 0;
        
        if (op > 0) { 
          ctx.font = '24px Arial'; 
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = op; 
          ctx.fillText('❤️', h.x, h.y); 
          ctx.globalAlpha = 1; 
          visibilityMap.current.set(h.id, op - 0.005); 
        }
        
        if (Math.hypot(playerPos.current.x - h.x, playerPos.current.y - h.y) < 25) { 
          h.collected = true; 
          setLives(v => Math.min(v + 1, 15)); 
          playSound(800, 'sine', 0.3, 0.2); 
        }
      });

      // Paquetes de ecos
      level.echoPacks?.forEach(e => {
        if (e.collected) return; 
        const op = visibilityMap.current.get(e.id) || 0;
        
        if (op > 0) { 
          ctx.beginPath(); 
          ctx.arc(e.x, e.y, 10, 0, Math.PI * 2); 
          ctx.fillStyle = `rgba(34, 211, 238, ${op})`; 
          ctx.fill(); 
          
          ctx.strokeStyle = `rgba(34, 211, 238, ${op * 0.7})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 14, 0, Math.PI * 2);
          ctx.stroke();
          
          visibilityMap.current.set(e.id, op - 0.005); 
        }
        
        if (Math.hypot(playerPos.current.x - e.x, playerPos.current.y - e.y) < 24) { 
          e.collected = true; 
          setEchoes(v => v + 20);
          playSound(1200, 'sine', 0.3, 0.2); 
        }
      });

      // Campo de protección estático
      const shieldPos = level.shield || SHIELD_POSITION;
      
      if (isInShield) {
        const pulseIntensity = 0.7 + 0.3 * Math.sin(Date.now() / 300);
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, SHIELD_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(168, 85, 247, ${pulseIntensity})`;
        ctx.lineWidth = 4;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, SHIELD_RADIUS - 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(192, 132, 252, ${pulseIntensity * 0.9})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        const particleCount = 8;
        for (let i = 0; i < particleCount; i++) {
          const angle = (i * (Math.PI * 2) / particleCount) + (Date.now() / 1500);
          const px = playerPos.current.x + Math.cos(angle) * (SHIELD_RADIUS - 5);
          const py = playerPos.current.y + Math.sin(angle) * (SHIELD_RADIUS - 5);
          
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(168, 85, 247, ${0.8 + 0.2 * Math.sin(Date.now() / 500 + i)})`;
          ctx.fill();
        }
      }

      // Llave
      if (!hasKey) {
        const op = visibilityMap.current.get('key') || 0;
        if (op > 0) { 
          ctx.font = '26px Arial'; 
          ctx.textAlign = 'center'; 
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = op; 
          ctx.fillText('🔑', level.key.x, level.key.y); 
          ctx.globalAlpha = 1; 
          visibilityMap.current.set('key', op - 0.005); 
        }
        
        if (Math.hypot(playerPos.current.x - level.key.x, playerPos.current.y - level.key.y) < 30) { 
          setHasKey(true); 
          playSound(900, 'triangle', 0.4, 0.2); 
        }
      }

      // Meta
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b'; 
      ctx.lineWidth = 4; 
      ctx.beginPath(); 
      ctx.arc(level.end.x, level.end.y, 38, 0, Math.PI * 2); 
      ctx.stroke();
      
      if (hasKey) {
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.5 + 0.5 * Math.sin(Date.now() / 200)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(level.end.x, level.end.y, 42, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      if (hasKey && Math.hypot(playerPos.current.x - level.end.x, playerPos.current.y - level.end.y) < 38) winLevel();

      // Avatar del jugador
      ctx.save(); 
      ctx.beginPath(); 
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2); 
      ctx.clip();
      
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fill();
      
      const img = new Image(); 
      img.src = profile.avatar; 
      ctx.drawImage(img, playerPos.current.x - PLAYER_RADIUS, playerPos.current.y - PLAYER_RADIUS, PLAYER_RADIUS*2, PLAYER_RADIUS*2); 
      
      ctx.strokeStyle = isInShield ? '#a855f7' : '#ffffff';
      ctx.lineWidth = isInShield ? 3 : 2;
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
      
      if (isInShield) {
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, SHIELD_RADIUS - 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#a855f7';
        ctx.fillText('🛡️ PROTEGIDO', playerPos.current.x, playerPos.current.y - SHIELD_RADIUS - 10);
      }
      
      // Indicador de portal revelado
      if (revealedPortals.size > 0 && usedPortals.size === 0) {
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#00ff7f';
        ctx.fillText('🌀 Portal revelado - Úsalo antes de que desaparezca', 10, 50);
      }
      
      if (gameMode === 'CREATIVE') {
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#10b981';
        ctx.fillText(`MODO: ${editorMode}`, 10, 10);
        ctx.fillText('Haz clic para colocar objetos', 10, 30);
      } else if (gameMode === 'CAMPAIGN') {
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = level.difficulty === 'FÁCIL' ? '#10b981' : 
                        level.difficulty === 'MEDIO' ? '#f59e0b' : '#ef4444';
        ctx.fillText(`Dificultad: ${level.difficulty}`, 10, 10);
        ctx.fillText(`Nivel: ${currentLevel + 1}/100`, 10, 30);
      }
      
      animationFrame = requestAnimationFrame(render);
    };

    const winLevel = () => {
      const next = currentLevel + 1; 
      setCurrentLevel(next); 
      setMaxLevelReached(v => Math.max(v, next)); 
      setTotalScore(v => v + 1000); 
      setHasKey(false);
      setRevealedPortals(new Set());
      setUsedPortals(new Set());
      
      setCoins(v => v + 5);
      setEchoes(v => Math.min(v + 5, 100));
      
      visibilityMap.current.clear(); 
      playerPos.current = { ...currentLevelData.start }; 
      playSound(1200, 'sine', 0.5, 0.2); 
      
      saveGameState({ 
        currentLevel: next, 
        totalScore: totalScore + 1000,
        coins: coins + 5,
        echoes: Math.min(echoes + 5, 100)
      });
    };

    animationFrame = requestAnimationFrame(render);
    
    return () => { 
      cancelAnimationFrame(animationFrame); 
      canvas.removeEventListener('mousedown', handleInputDown); 
      canvas.removeEventListener('touchstart', handleInputDown);
      window.removeEventListener('mousemove', handleInputMove); 
      window.removeEventListener('touchmove', handleInputMove);
      window.removeEventListener('mouseup', handleInputUp); 
      window.removeEventListener('touchend', handleInputUp);
    };
  }, [gameState, currentLevelData, hasKey, isMuted, profile.avatar, isInShield, gameMode, editorMode, revealedPortals, usedPortals]);

  // Respawn Timer
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
  
  const currentRespawnPrice = useMemo(() => Math.max(1, INITIAL_RESPAWN_PRICE - livesBoughtInSession), [livesBoughtInSession]);
  
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
    } 
  };
  
  const restartFromLevel1 = () => { 
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    
    setCurrentLevel(0); 
    setLives(INITIAL_LIVES); 
    setEchoes(INITIAL_ECHOES); 
    setHasKey(false); 
    setRevealedPortals(new Set());
    setUsedPortals(new Set());
    
    playerPos.current = { x: 70, y: 70 }; 
    visibilityMap.current.clear(); 
    setGameState('PLAYING'); 
    
    saveGameState({ 
      currentLevel: 0, 
      lives: INITIAL_LIVES, 
      echoes: INITIAL_ECHOES 
    });
  };

  // Limpiar timers al desmontar
  useEffect(() => {
    return () => {
      if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    };
  }, []);

  // Inicializar editor
  const startCreativeMode = () => {
    setGameMode('CREATIVE');
    setGameState('PLAYING');
    setEditingLevel({
      id: 'editor',
      walls: [],
      crosses: [],
      patrols: [],
      orbits: [],
      portals: [],
      coins: [],
      hearts: [],
      echoPacks: [],
      shield: { x: 300, y: 300, radius: SHIELD_RADIUS },
      start: { x: 70, y: 70 },
      end: { x: 530, y: 530 },
      key: { x: 400, y: 400 },
      projectileSpeed: 4,
      projectileSpawnRate: 1500,
      difficulty: 'PERSONALIZADO',
      custom: true
    });
    editorObjects.current = {
      walls: [],
      crosses: [],
      patrols: [],
      orbits: [],
      coins: [],
      hearts: [],
      echoPacks: [],
      portals: [],
      shield: { x: 300, y: 300, radius: SHIELD_RADIUS },
      start: { x: 70, y: 70 },
      end: { x: 530, y: 530 },
      key: { x: 400, y: 400 }
    };
    setRevealedPortals(new Set());
    setUsedPortals(new Set());
  };

  const playCustomLevel = (level) => {
    setGameMode('CAMPAIGN');
    setGameState('PLAYING');
    setEditingLevel(level);
    setCurrentLevel(0);
    setRevealedPortals(new Set());
    setUsedPortals(new Set());
  };

  if (gameState === 'LOADING') {
    return (
      <div className="h-screen bg-slate-950 flex items-center justify-center text-cyan-400 font-black tracking-widest uppercase">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⚪</div>
          <div className="animate-pulse">Cargando Sandeco Ball...</div>
        </div>
      </div>
    );
  }

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white overflow-y-auto">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] w-full max-w-md text-center backdrop-blur-xl shadow-2xl">
          <h2 className="text-2xl font-black italic mb-6 uppercase tracking-tighter text-white">
            Crea tu Piloto
          </h2>
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <img 
                src={profile.avatar} 
                className="w-24 h-24 rounded-full border-4 border-cyan-500 object-cover shadow-xl" 
                alt="Avatar" 
              />
              <button 
                onClick={() => fileInputRef.current.click()} 
                className="absolute bottom-0 right-0 bg-cyan-500 p-2 rounded-full border-2 border-slate-900 text-slate-900 shadow-lg hover:scale-110 transition-transform"
              >
                📷
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                hidden 
                accept="image/*" 
                onChange={handleImageUpload} 
              />
            </div>
            <div className="flex gap-2 pb-2 overflow-x-auto w-full justify-center text-white">
              {DEFAULT_AVATARS.map((av, i) => (
                <button 
                  key={i} 
                  onClick={() => setProfile({ ...profile, avatar: av })} 
                  className="w-10 h-10 rounded-full border-2 border-slate-700 overflow-hidden flex-shrink-0 hover:border-cyan-500 transition-colors"
                >
                  <img src={av} alt="cartoon" />
                </button>
              ))}
            </div>
            <input 
              type="text" 
              placeholder="Nombre del piloto..." 
              className="w-full p-4 bg-slate-950 rounded-xl border border-slate-800 text-white font-bold text-center outline-none focus:border-cyan-500 placeholder-slate-600" 
              value={profile.name} 
              onChange={(e) => setProfile({ ...profile, name: e.target.value })} 
              maxLength={20}
            />
            <button 
              onClick={saveProfile} 
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-black rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg uppercase tracking-wider"
            >
              Comenzar Aventura
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col h-screen overflow-hidden select-none touch-none font-sans">
      {/* Header */}
      <header className="flex-none p-4 flex flex-col gap-3 bg-slate-900/80 border-b border-slate-800/50 z-50 backdrop-blur-sm">
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-3">
            <img 
              src={profile.avatar} 
              className="w-10 h-10 rounded-full border-2 border-cyan-500 shadow-lg" 
              alt="Avatar" 
            />
            <div className="hidden sm:block">
              <div className="font-black text-sm leading-none truncate max-w-[100px] text-white">
                {profile.name}
              </div>
              <div className="text-[7px] text-cyan-500 uppercase font-black tracking-widest mt-1 text-white">
                {gameMode === 'CREATIVE' ? 'MODO: CREATIVO' : 
                 gameMode === 'CAMPAIGN' ? 'MODO: CAMPAÑA' : 'MODO: ALEATORIO'}
              </div>
            </div>
          </div>
          
          <h1 className="text-xl font-black italic tracking-tighter uppercase leading-none bg-gradient-to-r from-white to-cyan-400 bg-clip-text text-transparent">
            SANDECO <span className="text-cyan-400">BALL</span> ⚪
          </h1>
          
          <div className="flex gap-2 items-center">
            {installPrompt && (
              <button 
                onClick={handleInstallClick} 
                className="px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-slate-900 rounded-xl font-black text-[10px] hover:scale-105 animate-pulse shadow-lg"
              >
                📱 INSTALAR
              </button>
            )}
            <button 
              onClick={() => setIsMuted(!isMuted)} 
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl w-10 h-10 flex items-center justify-center hover:bg-slate-700 transition-colors"
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button 
              onClick={toggleFullscreen} 
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl w-10 h-10 flex items-center justify-center hover:bg-slate-700 transition-colors"
            >
              {isFullscreen ? '⤓' : '⤢'}
            </button>
          </div>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-5 gap-1 text-white">
          <StatBox 
            label={gameMode === 'CREATIVE' ? "EDITOR" : "Nivel"} 
            value={gameMode === 'CREATIVE' ? "🎨" : currentLevel + 1} 
            icon={gameMode === 'CREATIVE' ? "🎨" : "📊"}
          />
          <StatBox 
            label="Vidas" 
            value={lives} 
            color={lives < 3 ? 'text-red-500' : 'text-white'}
            icon="❤️"
          />
          <StatBox 
            label="Ecos" 
            value={echoes} 
            color="text-cyan-400"
            icon="🌀"
          />
          <StatBox 
            label="Coins" 
            value={coins} 
            color="text-amber-400"
            icon="🪙"
          />
          <StatBox 
            label="Score" 
            value={totalScore} 
            color="text-emerald-400"
            icon="⭐"
          />
        </div>
        
        {/* Indicador de protección */}
        {isInShield && gameState === 'PLAYING' && gameMode !== 'CREATIVE' && (
          <div className="flex items-center gap-2 mt-2 text-purple-400 text-xs font-bold animate-pulse">
            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
            <span>🛡️ PROTEGIDO DENTRO DEL CAMPO DE ENERGÍA</span>
          </div>
        )}
        
        {/* Indicador de portal */}
        {revealedPortals.size > 0 && usedPortals.size === 0 && gameState === 'PLAYING' && gameMode !== 'CREATIVE' && (
          <div className="flex items-center gap-2 mt-2 text-green-400 text-xs font-bold animate-pulse">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>🌀 PORTAL REVELADO - Toca la pantalla (gasta eco) para encontrar portales</span>
          </div>
        )}
        
        {/* Herramientas del editor */}
        {gameMode === 'CREATIVE' && gameState === 'PLAYING' && (
          <div className="flex flex-wrap gap-2 mt-2">
            <select 
              value={editorMode}
              onChange={(e) => setEditorMode(e.target.value)}
              className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs"
            >
              <option value="SELECT">Seleccionar</option>
              <option value="WALL">🏗️ Pared</option>
              <option value="ENEMY">❌ Cruz (3x grande/lenta)</option>
              <option value="PATROL">🔄 Patrulla</option>
              <option value="PORTAL">🌀 Portal</option>
              <option value="ITEM">🪙 Moneda</option>
              <option value="HEART">❤️ Vida</option>
              <option value="ECHO">🌀 Eco</option>
              <option value="START">🚀 Inicio</option>
              <option value="END">🏁 Meta</option>
              <option value="KEY">🔑 Llave</option>
              <option value="SHIELD">🛡️ Campo Protección</option>
              <option value="DELETE">🗑️ Eliminar</option>
            </select>
            
            <button 
              onClick={saveCustomLevel}
              disabled={!levelName.trim()}
              className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              💾 Guardar Nivel
            </button>
            
            <button 
              onClick={() => setGameState('START')}
              className="px-3 py-1 bg-slate-700 text-white rounded-lg text-xs hover:bg-slate-600"
            >
              🏠 Salir
            </button>
          </div>
        )}
      </header>

      {/* Main Game Area */}
      <main className="flex-1 relative flex items-center justify-center bg-black overflow-hidden p-2">
        <div className="relative w-full h-full max-w-[600px] max-h-[600px] aspect-square">
          <canvas 
            ref={canvasRef} 
            width={CANVAS_SIZE} 
            height={CANVAS_SIZE} 
            className="w-full h-full object-contain block touch-none border-2 border-slate-800 rounded-2xl bg-[#01050a] shadow-2xl" 
          />

          {/* START SCREEN */}
          {gameState === 'START' && (
            <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-md z-40 rounded-2xl text-white">
              <h1 className="text-4xl sm:text-6xl font-black italic mb-2 tracking-tighter uppercase text-white drop-shadow-lg">
                SANDECO BALL ⚪
              </h1>
              <p className="text-slate-400 mb-8 max-w-xs text-xs font-bold uppercase tracking-widest leading-relaxed">
                Campo de protección • Portal oculto • Cruces 3x • Creador de niveles
              </p>
              
              <div className="flex flex-col gap-4 w-full max-w-xs text-white">
                <button 
                  onClick={() => { 
                    setGameMode('CAMPAIGN'); 
                    setGameState('PLAYING'); 
                  }} 
                  className="py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black rounded-3xl text-2xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-cyan-500/30 uppercase tracking-wider"
                >
                  🎮 CAMPAÑA PROGRESIVA
                </button>
                
                <button 
                  onClick={() => { 
                    setGameMode('RANDOM'); 
                    setGameState('PLAYING'); 
                  }} 
                  className="py-5 bg-gradient-to-r from-slate-300 to-slate-400 text-slate-950 font-black rounded-3xl text-2xl hover:scale-105 active:scale-95 transition-all uppercase tracking-wider"
                >
                  🎲 MODO ALEATORIO
                </button>
                
                <button 
                  onClick={startCreativeMode} 
                  className="py-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-black rounded-3xl text-2xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-purple-500/30 uppercase tracking-wider"
                >
                  🎨 MODO CREATIVO
                </button>
                
                <div className="grid grid-cols-3 gap-3">
                  <button 
                    onClick={() => setGameState('RANKING')} 
                    className="py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase hover:bg-slate-800 text-white transition-colors"
                  >
                    🏆 Ranking
                  </button>
                  <button 
                    onClick={() => setGameState('STORE')} 
                    className="py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase hover:bg-slate-800 text-white transition-colors"
                  >
                    🛒 Tienda
                  </button>
                  <button 
                    onClick={() => setGameState('COMMUNITY')} 
                    className="py-4 bg-slate-900 border border-slate-800 rounded-2xl font-black text-xs uppercase hover:bg-slate-800 text-white transition-colors"
                  >
                    🌍 Comunidad
                  </button>
                </div>
              </div>
              
              <div className="mt-8 flex items-center gap-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-800">
                <img 
                  src={profile.avatar} 
                  className="w-10 h-10 rounded-full border border-cyan-500" 
                  alt="Avatar" 
                />
                <span className="font-bold text-slate-300 text-sm">
                  {profile.name}
                </span>
              </div>
            </div>
          )}

          {/* RESPAWN SCREEN */}
          {gameState === 'RESPAWN' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-6 text-center backdrop-blur-xl z-40 rounded-2xl overflow-y-auto text-white">
              <div className="text-7xl mb-4 animate-bounce">💀</div>
              <h2 className="text-3xl font-black text-white mb-2 uppercase italic tracking-tighter">
                SISTEMA DAÑADO
              </h2>
              <div className="text-7xl font-black text-cyan-400 mb-6 tabular-nums animate-pulse">
                {respawnTimeLeft}s
              </div>
              
              <div className="mb-6 bg-slate-900/50 p-4 rounded-2xl border border-slate-800 text-white flex items-center justify-between w-full max-w-xs">
                <div className="text-left">
                  <div className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                    Recursos disponibles
                  </div>
                  <div className="text-lg font-black">
                    {lives} ❤️ • {echoes} 🌀 • {coins} 🪙
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col gap-3 w-full max-w-xs text-white">
                <button 
                  onClick={buyLife} 
                  disabled={coins < currentRespawnPrice} 
                  className={`py-4 rounded-xl font-black text-lg transition-all shadow-lg ${coins >= currentRespawnPrice ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 hover:scale-105 active:scale-95' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                >
                  {coins >= currentRespawnPrice ? 
                    `+1 VIDA (${currentRespawnPrice} 🪙)` : 
                    `FALTAN ${currentRespawnPrice - coins} 🪙`
                  }
                </button>
                
                <button 
                  onClick={continueAfterRespawn} 
                  disabled={lives === 0} 
                  className={`py-4 font-black rounded-xl text-lg uppercase shadow-md transition-all ${lives > 0 ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 hover:scale-105' : 'bg-slate-800 text-slate-600 opacity-50 cursor-not-allowed'}`}
                >
                  Continuar con protección
                </button>
                
                <button 
                  onClick={restartFromLevel1} 
                  className="py-3 bg-gradient-to-r from-white to-slate-200 text-slate-900 font-black rounded-xl text-sm uppercase hover:scale-105"
                >
                  🔄 Reiniciar desde Nivel 1
                </button>
                
                <button 
                  onClick={handleExitToMenu} 
                  className="py-3 bg-gradient-to-r from-red-600/10 to-red-500/10 text-red-500 border border-red-500/30 font-black rounded-xl text-sm uppercase hover:bg-red-600/20"
                >
                  🏠 Menú Principal
                </button>
              </div>
            </div>
          )}

          {/* RANKING SCREEN */}
          {gameState === 'RANKING' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl z-40 rounded-2xl text-white text-left overflow-hidden">
              <div className="flex justify-between items-center mb-6 text-white">
                <h2 className="text-2xl font-black italic uppercase text-cyan-400">
                  🏆 Récords Globales
                </h2>
                <button 
                  onClick={() => setGameState('START')} 
                  className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-full text-white font-bold text-xl flex items-center justify-center hover:bg-slate-700 text-white transition-colors"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-2 overflow-y-auto pr-2 flex-1 scrollbar-hide text-white">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No hay récords todavía. ¡Sé el primero!
                  </div>
                ) : (
                  leaderboard.map((p, i) => (
                    <div 
                      key={i} 
                      className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${p.uid === user?.uid ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'bg-slate-900/50 border-slate-800'}`}
                    >
                      <div className="flex items-center gap-4 text-white">
                        <span className={`w-6 font-black text-xs ${i < 3 ? 'text-amber-400' : 'text-slate-600'}`}>
                          {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                        </span>
                        <img 
                          src={p.avatar} 
                          className="w-10 h-10 rounded-full border border-slate-700" 
                          alt="" 
                        />
                        <div className="text-left">
                          <div className="font-bold text-sm text-white leading-tight truncate max-w-[100px]">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                            Nivel {p.level}
                          </div>
                        </div>
                      </div>
                      <div className="text-cyan-400 font-black text-lg tracking-tighter">
                        {p.score.toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* STORE SCREEN */}
          {gameState === 'STORE' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl z-40 rounded-2xl text-white overflow-hidden">
              <div className="flex justify-between items-center mb-8 text-white">
                <h2 className="text-2xl font-black italic uppercase text-white">
                  🛒 Almacén de Suministros
                </h2>
                <button 
                  onClick={() => setGameState('START')} 
                  className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-full text-white font-bold text-xl flex items-center justify-center hover:bg-slate-700 text-white transition-colors"
                >
                  ✕
                </button>
              </div>
              
              <div className="mb-6 bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                <div className="text-sm text-slate-400 mb-2">Tus recursos:</div>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-black">{echoes}</span>
                    <span className="text-xs text-slate-500">Ecos</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-black">{coins}</span>
                    <span className="text-xs text-slate-500">Monedas</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 font-black">{lives}</span>
                    <span className="text-xs text-slate-500">Vidas</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4 overflow-y-auto pr-2 flex-1">
                <StoreItem 
                  title="Bolsa de 15 Ecos" 
                  description="Energía adicional para revelar secretos"
                  price="10 🪙" 
                  onBuy={() => { 
                    if (coins >= 10) { 
                      setCoins(v => v - 10); 
                      setEchoes(v => v + 15); 
                      playSound(800, 'sine', 0.3, 0.2);
                    } 
                  }} 
                />
                <StoreItem 
                  title="Vida Extra" 
                  description="Aumenta tu resistencia"
                  price="25 🪙" 
                  onBuy={() => { 
                    if (coins >= 25) { 
                      setCoins(v => v - 25); 
                      setLives(v => Math.min(v + 1, 15)); 
                      playSound(1000, 'sine', 0.3, 0.2);
                    } 
                  }} 
                />
                <StoreItem 
                  title="Célula de Energía (50 Ecos)" 
                  description="Reserva estratégica máxima"
                  price="30 🪙" 
                  onBuy={() => { 
                    if (coins >= 30) { 
                      setCoins(v => v - 30); 
                      setEchoes(v => v + 50); 
                      playSound(1200, 'sine', 0.3, 0.2);
                    } 
                  }} 
                />
                <StoreItem 
                  title="Boost de Velocidad" 
                  description="Movimiento más rápido por 30s"
                  price="20 🪙" 
                  onBuy={() => { 
                    if (coins >= 20) { 
                      setCoins(v => v - 20); 
                      playSound(700, 'sine', 0.3, 0.2);
                    } 
                  }} 
                />
              </div>
            </div>
          )}

          {/* COMMUNITY SCREEN */}
          {gameState === 'COMMUNITY' && (
            <div className="absolute inset-0 bg-slate-950/98 flex flex-col p-8 backdrop-blur-xl z-40 rounded-2xl text-white overflow-hidden">
              <div className="flex justify-between items-center mb-8 text-white">
                <h2 className="text-2xl font-black italic uppercase text-white">
                  🌍 Niveles de la Comunidad
                </h2>
                <button 
                  onClick={() => setGameState('START')} 
                  className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-full text-white font-bold text-xl flex items-center justify-center hover:bg-slate-700 text-white transition-colors"
                >
                  ✕
                </button>
              </div>
              
              <div className="space-y-3 overflow-y-auto pr-2 flex-1">
                {customLevels.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No hay niveles creados todavía. ¡Sé el primero en crear uno!
                  </div>
                ) : (
                  customLevels.map((level) => (
                    <div key={level.id} className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="font-black text-white">{level.name || 'Sin nombre'}</h3>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => playCustomLevel(level)}
                            className="px-3 py-1 bg-cyan-600 text-white rounded-lg text-xs hover:bg-cyan-700"
                          >
                            🎮 Jugar
                          </button>
                          {level.creatorId === user?.uid && (
                            <button 
                              onClick={() => deleteCustomLevel(level.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-slate-400 text-sm mb-2">{level.description || 'Sin descripción'}</p>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Creado por: {level.creator || 'Anónimo'}</span>
                        <span>Dificultad: {level.difficulty || 'MEDIA'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              <div className="mt-6 p-4 bg-slate-900/30 rounded-2xl border border-slate-800">
                <h3 className="font-black text-white mb-3">Crear Nuevo Nivel</h3>
                <input 
                  type="text" 
                  placeholder="Nombre del nivel"
                  className="w-full p-3 bg-slate-800 rounded-xl mb-2 text-white placeholder-slate-500"
                  value={levelName}
                  onChange={(e) => setLevelName(e.target.value)}
                />
                <textarea 
                  placeholder="Descripción del nivel"
                  className="w-full p-3 bg-slate-800 rounded-xl mb-3 text-white placeholder-slate-500 h-20"
                  value={levelDescription}
                  onChange={(e) => setLevelDescription(e.target.value)}
                />
                <button 
                  onClick={startCreativeMode}
                  disabled={!levelName.trim()}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-black rounded-xl hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🎨 Ir al Editor de Niveles
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="flex-none p-4 bg-slate-900/80 border-t border-slate-800/50 flex flex-col items-center gap-3 z-50 text-white backdrop-blur-sm">
        {gameState === 'PLAYING' && gameMode !== 'CREATIVE' && (
          <button 
            onClick={handleExitToMenu} 
            className="w-full max-w-[600px] py-4 bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-700 rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] text-slate-300 hover:text-white transition-all shadow-xl hover:bg-slate-700 text-white"
          >
            💾 Guardar y Salir al Menú
          </button>
        )}
        
        {gameState === 'PLAYING' && gameMode === 'CREATIVE' && (
          <div className="w-full max-w-[600px] text-center text-xs text-slate-400">
            <p>🎨 <strong>Modo Creativo:</strong> Haz clic para colocar objetos. Cambia herramientas desde el menú superior.</p>
            <p className="mt-1">🛡️ <strong>Campo de protección violeta:</strong> Protege mientras estés dentro.</p>
            <p className="mt-1">🌀 <strong>Portal oculto:</strong> Gasta ecos tocando la pantalla para revelarlo.</p>
          </div>
        )}
        
        {gameState !== 'PLAYING' && (
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.5em] animate-pulse text-center">
            Sandeco Ball ⚪ • Campo de Protección • Portal Oculto • Editor de Niveles
          </p>
        )}
        
        {gameState === 'PLAYING' && gameMode !== 'CREATIVE' && (
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-[0.5em] animate-pulse text-center">
            Arrastra el Piloto • Toca la pantalla (gasta eco) para revelar portal • Campo violeta = Protección
          </p>
        )}
      </footer>
    </div>
  );
};

// Componente de caja de estadísticas
const StatBox = ({ label, value, color = "text-white", icon = "" }) => (
  <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/50 text-center flex flex-col justify-center min-w-0 shadow-inner text-white hover:bg-slate-800 transition-colors">
    <div className="text-[7px] sm:text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1 leading-none text-white flex items-center justify-center gap-1">
      {icon && <span>{icon}</span>}
      <span>{label}</span>
    </div>
    <div className={`text-xs sm:text-base font-black ${color} tracking-tighter leading-none text-white`}>
      {value}
    </div>
  </div>
);

// Componente de item de tienda
const StoreItem = ({ title, description, price, onBuy }) => (
  <button 
    onClick={onBuy} 
    className="w-full flex justify-between items-center p-5 bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-700 rounded-3xl hover:from-slate-800 hover:to-slate-700 transition-all shadow-lg active:scale-95 group text-white text-left"
  >
    <div className="text-white">
      <div className="font-black text-sm text-white group-hover:text-cyan-400 transition-colors uppercase tracking-tight text-white">
        {title}
      </div>
      <div className="text-[9px] text-slate-500 font-medium tracking-wide leading-tight mt-1 text-white">
        {description}
      </div>
    </div>
    <span className="bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-950 px-4 py-2 rounded-xl font-black text-xs shadow-md group-active:scale-95 transition-transform text-white">
      {price}
    </span>
  </button>
);

export default App;
