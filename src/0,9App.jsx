import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

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
const appId = 'echo-path-pro-final';

// --- CONFIGURACIÓN Y CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 12;
const HITBOX_RELAX = 40;
const INITIAL_LIVES = 5;
const INITIAL_ECHOES = 30;

const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Milo",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Zoe"
];

const App = () => {
  const canvasRef = useRef(null);
  
  // Estados de Usuario y Firebase
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ name: '', avatar: DEFAULT_AVATARS[0] });
  const [isProfileSet, setIsProfileSet] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [globalPlayerCount, setGlobalPlayerCount] = useState(0);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('LOADING'); // LOADING, SETUP, START, PLAYING, GAMEOVER, WIN, STORE, RANKING
  const [currentLevel, setCurrentLevel] = useState(0);
  const [maxLevelReached, setMaxLevelReached] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  // Recursos y Progreso
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [echoes, setEchoes] = useState(INITIAL_ECHOES);
  const [coins, setCoins] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [totalScore, setTotalScore] = useState(0);

  // Referencias para el motor de físicas y renderizado
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const audioCtx = useRef(null);
  const masterGain = useRef(null);

  // --- INICIALIZACIÓN FIREBASE ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        const u = await signInAnonymously(auth);
        setUser(u.user);
      } catch (err) { 
        console.error("Auth Error", err);
        setGameState('START');
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Cargar perfil privado
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    getDoc(profileRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile({ name: data.name, avatar: data.avatar });
        setIsProfileSet(true);
        setGameState('START');
      } else {
        setGameState('SETUP');
      }
    });

    // Cargar stats privados
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(statsRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setMaxLevelReached(data.maxLevel || 0);
        setCoins(data.coins || 0);
        setTotalScore(data.score || 0);
        setLives(data.lives || INITIAL_LIVES);
        setEchoes(data.echoes || INITIAL_ECHOES);
      }
    });

    // Escuchar Ranking Global (Público)
    const rankingRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubRanking = onSnapshot(rankingRef, (snap) => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => b.score - a.score);
      setLeaderboard(docs);
      setGlobalPlayerCount(docs.length);
    });

    return () => unsubRanking();
  }, [user]);

  const saveProfile = async () => {
    if (!profile.name || !user) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    await setDoc(profileRef, profile);
    
    // Inicializar entrada en leaderboard
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    await setDoc(leadRef, { 
        name: profile.name, 
        avatar: profile.avatar, 
        score: totalScore, 
        level: currentLevel + 1,
        uid: user.uid 
    }, { merge: true });
    
    setIsProfileSet(true);
    setGameState('START');
  };

  const syncProgress = async () => {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    
    await setDoc(statsRef, { 
      maxLevel: Math.max(maxLevelReached, currentLevel), 
      coins, 
      score: totalScore,
      lives,
      echoes
    }, { merge: true });
    
    await setDoc(leadRef, { 
      score: totalScore, 
      level: currentLevel + 1 
    }, { merge: true });
  };

  // --- GENERADOR PROCEDURAL DE 100 NIVELES ---
  const levelData = useMemo(() => {
    return Array.from({ length: 100 }, (_, i) => {
      const diff = i / 100;
      const walls = [
        { x: 0, y: 0, w: CANVAS_SIZE, h: 20, id: `b-t-${i}` },
        { x: 0, y: CANVAS_SIZE - 20, w: CANVAS_SIZE, h: 20, id: `b-b-${i}` },
        { x: 0, y: 0, w: 20, h: CANVAS_SIZE, id: `b-l-${i}` },
        { x: CANVAS_SIZE - 20, y: 0, w: 20, h: CANVAS_SIZE, id: `b-r-${i}` }
      ];
      
      const movingWalls = [];
      const coinsOnMap = [];
      const healthPacks = [];
      const echoPacks = [];

      // Generar muros estáticos
      const wallCount = 5 + Math.floor(diff * 25);
      for (let j = 0; j < wallCount; j++) {
        walls.push({
          x: 100 + Math.random() * 380,
          y: 100 + Math.random() * 380,
          w: 40 + Math.random() * (50 + diff * 60),
          h: 40 + Math.random() * (50 + diff * 60),
          id: `w-${i}-${j}`
        });
      }

      // Generar monedas
      const coinCount = 4 + Math.floor(Math.random() * 5);
      for (let j = 0; j < coinCount; j++) {
        coinsOnMap.push({
          x: 80 + Math.random() * 440,
          y: 80 + Math.random() * 440,
          id: `c-${i}-${j}`,
          collected: false
        });
      }

      // Generar packs de vida (25% de probabilidad por nivel)
      if (Math.random() > 0.75) {
        healthPacks.push({
          x: 120 + Math.random() * 360,
          y: 120 + Math.random() * 360,
          id: `h-${i}`,
          collected: false
        });
      }

      // Generar packs de eco (25% de probabilidad por nivel)
      if (Math.random() > 0.75) {
        echoPacks.push({
          x: 120 + Math.random() * 360,
          y: 120 + Math.random() * 360,
          id: `e-${i}`,
          collected: false
        });
      }

      // Generar enemigos móviles
      if (i >= 3) {
        const moveCount = 1 + Math.floor(diff * 15);
        for (let j = 0; j < moveCount; j++) {
          movingWalls.push({
            x: 150 + Math.random() * 300,
            y: 150 + Math.random() * 300,
            w: 25, h: 25,
            vx: (Math.random() - 0.5) * (5 + diff * 12),
            vy: (Math.random() - 0.5) * (5 + diff * 12),
            id: `m-${i}-${j}`
          });
        }
      }

      // FUNCIÓN PARA ENCONTRAR POSICIÓN SEGURA PARA LA LLAVE
      const findSafeKeyPos = () => {
        let attempts = 0;
        while (attempts < 50) {
          const x = 100 + Math.random() * 400;
          const y = 100 + Math.random() * 400;
          const radius = 15;
          
          // Verificar colisión con muros
          const collision = walls.some(w => {
            const cx = Math.max(w.x, Math.min(x, w.x + w.w));
            const cy = Math.max(w.y, Math.min(y, w.y + w.h));
            return Math.hypot(x - cx, y - cy) < radius + 10;
          });

          if (!collision) return { x, y };
          attempts++;
        }
        return { x: 300, y: 300 }; // Fail-safe al centro
      };

      return {
        id: i,
        title: `FASE ${i + 1}`,
        walls,
        movingWalls,
        coins: coinsOnMap,
        healthPacks,
        echoPacks,
        start: { x: 70, y: 70 },
        end: { x: 530, y: 530 },
        key: findSafeKeyPos()
      };
    });
  }, []);

  // --- AUDIO ENGINE ---
  const initAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      masterGain.current = audioCtx.current.createGain();
      masterGain.current.connect(audioCtx.current.destination);
    }
    masterGain.current.gain.setValueAtTime(isMuted ? 0 : 1, audioCtx.current.currentTime);
  };

  const playSound = (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
    if (isMuted || !audioCtx.current) return;
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
  };

  // --- BUCLE PRINCIPAL ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;
    initAudio();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrame;
    const currentLevelData = levelData[currentLevel];

    const handleInputDown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
      const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);

      const dist = Math.hypot(x - playerPos.current.x, y - playerPos.current.y);
      
      if (dist < HITBOX_RELAX) {
        isDragging.current = true;
      } else if (echoes > 0) {
        pulses.current.push({ x, y, r: 0, maxR: 500, alpha: 1 });
        setEchoes(prev => prev - 1);
        playSound(440, 'sine', 0.4, 0.05);
      }
    };

    const handleInputMove = (e) => {
      if (!isDragging.current) return;
      if (e.cancelable) e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
      const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
      
      playerPos.current = { x, y };
    };

    const handleInputUp = () => { isDragging.current = false; };

    canvas.addEventListener('mousedown', handleInputDown);
    canvas.addEventListener('touchstart', handleInputDown, { passive: false });
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('touchmove', handleInputMove, { passive: false });
    window.addEventListener('mouseup', handleInputUp);
    window.addEventListener('touchend', handleInputUp);

    const render = () => {
      ctx.fillStyle = '#010409';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // 1. ONDAS DE ECO
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 12;
        p.alpha *= 0.95;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        const checkReveal = (obj, isCircle = false) => {
            let dist;
            if (isCircle) {
                dist = Math.hypot(p.x - obj.x, p.y - obj.y);
            } else {
                const cx = Math.max(obj.x, Math.min(p.x, obj.x + obj.w));
                const cy = Math.max(obj.y, Math.min(p.y, obj.y + obj.h));
                dist = Math.hypot(p.x - cx, p.y - cy);
            }
            if (Math.abs(dist - p.r) < 25) visibilityMap.current.set(obj.id || 'key', 1);
        };

        currentLevelData.walls.forEach(w => checkReveal(w));
        currentLevelData.coins.forEach(c => checkReveal(c, true));
        currentLevelData.healthPacks.forEach(h => checkReveal(h, true));
        currentLevelData.echoPacks.forEach(e => checkReveal(e, true));
        currentLevelData.movingWalls.forEach(m => checkReveal(m));
        if (currentLevelData.key) checkReveal(currentLevelData.key, true);
      });

      // 2. RENDERIZADO DE MUROS
      currentLevelData.walls.forEach(w => {
        const opacity = visibilityMap.current.get(w.id) || 0;
        if (opacity > 0) {
          ctx.fillStyle = `rgba(34, 211, 238, ${opacity})`;
          ctx.shadowBlur = 10 * opacity;
          ctx.shadowColor = '#22d3ee';
          ctx.fillRect(w.x, w.y, w.w, w.h);
          visibilityMap.current.set(w.id, opacity - 0.008);
        }
        const cx = Math.max(w.x, Math.min(playerPos.current.x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(playerPos.current.y, w.y + w.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 2) {
            setLives(prev => {
              const newLives = prev - 1;
              if (newLives <= 0) {
                setGameState('GAMEOVER');
                playSound(100, 'square', 0.4, 0.2);
                syncProgress();
                return 0;
              } else {
                playerPos.current = currentLevelData.start;
                visibilityMap.current.clear();
                playSound(150, 'square', 0.2, 0.1);
                return newLives;
              }
            });
        }
      });

      // 3. MONEDAS
      currentLevelData.coins.forEach(c => {
        if (c.collected) return;
        const opacity = visibilityMap.current.get(c.id) || 0;
        if (opacity > 0) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(251, 191, 36, ${opacity})`;
          ctx.shadowBlur = 20 * opacity;
          ctx.shadowColor = '#fbbf24';
          ctx.fill();
          visibilityMap.current.set(c.id, opacity - 0.006);
        }
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < 20) {
          c.collected = true;
          setCoins(prev => prev + 1);
          setTotalScore(prev => prev + 50);
          playSound(1400, 'sine', 0.1, 0.1);
        }
      });

      // 4. PACKS DE VIDA
      currentLevelData.healthPacks.forEach(h => {
        if (h.collected) return;
        const opacity = visibilityMap.current.get(h.id) || 0;
        if (opacity > 0) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(244, 63, 94, ${opacity})`;
          ctx.shadowBlur = 15 * opacity;
          ctx.shadowColor = '#f43f5e';
          ctx.fill();
          
          // Dibujar símbolo de corazón
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('❤', h.x, h.y);
          
          visibilityMap.current.set(h.id, opacity - 0.006);
        }
        if (Math.hypot(playerPos.current.x - h.x, playerPos.current.y - h.y) < 22) {
          h.collected = true;
          setLives(prev => Math.min(prev + 1, 10));
          setTotalScore(prev => prev + 100);
          playSound(800, 'sine', 0.3, 0.2);
        }
      });

      // 5. PACKS DE ECO
      currentLevelData.echoPacks.forEach(e => {
        if (e.collected) return;
        const opacity = visibilityMap.current.get(e.id) || 0;
        if (opacity > 0) {
          ctx.beginPath();
          ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34, 211, 238, ${opacity})`;
          ctx.shadowBlur = 15 * opacity;
          ctx.shadowColor = '#22d3ee';
          ctx.fill();
          
          // Dibujar símbolo de eco
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('📡', e.x, e.y);
          
          visibilityMap.current.set(e.id, opacity - 0.006);
        }
        if (Math.hypot(playerPos.current.x - e.x, playerPos.current.y - e.y) < 22) {
          e.collected = true;
          setEchoes(prev => prev + 15);
          setTotalScore(prev => prev + 75);
          playSound(1200, 'sine', 0.3, 0.2);
        }
      });

      // 6. ENEMIGOS (MÓVILES)
      currentLevelData.movingWalls.forEach(m => {
        m.x += m.vx; m.y += m.vy;
        if (m.x < 20 || m.x > 550) m.vx *= -1;
        if (m.y < 20 || m.y > 550) m.vy *= -1;

        const opacity = visibilityMap.current.get(m.id) || 0;
        if (opacity > 0) {
          ctx.fillStyle = `rgba(244, 63, 94, ${opacity})`;
          ctx.shadowBlur = 15 * opacity;
          ctx.shadowColor = '#f43f5e';
          ctx.fillRect(m.x, m.y, m.w, m.h);
          visibilityMap.current.set(m.id, opacity - 0.015);
        }
        const cx = Math.max(m.x, Math.min(playerPos.current.x, m.x + m.w));
        const cy = Math.max(m.y, Math.min(playerPos.current.y, m.y + m.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS) {
          setLives(prev => {
            const newLives = prev - 1;
            if (newLives <= 0) {
              setGameState('GAMEOVER');
              playSound(100, 'square', 0.4, 0.2);
              syncProgress();
              return 0;
            } else {
              playerPos.current = currentLevelData.start;
              visibilityMap.current.clear();
              playSound(150, 'square', 0.2, 0.1);
              return newLives;
            }
          });
        }
      });

      // 7. LLAVE Y PORTAL
      if (currentLevelData.key && !hasKey) {
        const opacity = visibilityMap.current.get('key') || 0;
        if (opacity > 0) {
          ctx.beginPath();
          ctx.arc(currentLevelData.key.x, currentLevelData.key.y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(34, 211, 238, ${opacity})`;
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.fillStyle = `rgba(34, 211, 238, ${opacity})`;
          ctx.fillRect(currentLevelData.key.x - 4, currentLevelData.key.y - 4, 8, 8);
          visibilityMap.current.set('key', opacity - 0.005);
        }
        if (Math.hypot(playerPos.current.x - currentLevelData.key.x, playerPos.current.y - currentLevelData.key.y) < 25) {
          setHasKey(true);
          playSound(880, 'triangle', 0.4, 0.2);
        }
      }

      // 8. PORTAL DE SALIDA
      ctx.beginPath();
      ctx.arc(currentLevelData.end.x, currentLevelData.end.y, 32, 0, Math.PI * 2);
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b';
      ctx.lineWidth = 6;
      if (!hasKey) ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
      
      if (hasKey) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.stroke();
          ctx.shadowBlur = 0;
      }

      // 9. COMPROBAR VICTORIA
      if (hasKey && Math.hypot(playerPos.current.x - currentLevelData.end.x, playerPos.current.y - currentLevelData.end.y) < 35) {
        if (currentLevel < 99) {
          const next = currentLevel + 1;
          setCurrentLevel(next);
          setMaxLevelReached(prev => Math.max(prev, next));
          playerPos.current = levelData[next].start;
          setHasKey(false);
          visibilityMap.current.clear();
          setTotalScore(prev => prev + 250);
          playSound(1100, 'sine', 0.8, 0.2);
          syncProgress();
        } else {
          setGameState('WIN');
          syncProgress();
        }
      }

      // 10. JUGADOR
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isDragging.current ? '#ffffff' : '#475569';
      ctx.shadowBlur = isDragging.current ? 30 : 0;
      ctx.shadowColor = '#ffffff';
      ctx.fill();
      ctx.shadowBlur = 0;

      animationFrame = requestAnimationFrame(render);
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
  }, [gameState, currentLevel, isMuted, hasKey, echoes, lives]);

  // Controles de Tienda
  const buyWithCoins = (type, amount, cost) => {
    if (coins >= cost) {
      setCoins(prev => prev - cost);
      if (type === 'echoes') {
        setEchoes(prev => prev + amount);
        playSound(700, 'sine', 0.3, 0.2);
      } else if (type === 'lives') {
        setLives(prev => Math.min(prev + amount, 10));
        playSound(800, 'sine', 0.3, 0.2);
      }
    }
  };

  const buyWithDollars = (type, amount) => {
    if (type === 'echoes') {
      setEchoes(prev => prev + amount);
    } else if (type === 'lives') {
      setLives(prev => prev + amount);
    }
    setShowPremiumModal(false);
    playSound(1500, 'sine', 0.5, 0.3);
  };

  const retry = () => {
    playerPos.current = levelData[currentLevel].start;
    setHasKey(false);
    visibilityMap.current.clear();
    setGameState('PLAYING');
  };

  const startNewGame = () => {
    setCurrentLevel(maxLevelReached);
    playerPos.current = levelData[maxLevelReached].start;
    setHasKey(false);
    visibilityMap.current.clear();
    setLives(INITIAL_LIVES);
    setEchoes(INITIAL_ECHOES);
    setGameState('PLAYING');
  };

  const isTop3 = leaderboard.slice(0, 3).some(p => p.uid === user?.uid);
  const rewardActive = globalPlayerCount >= 100 && isTop3;

  // --- PANTALLAS DE CARGA Y SETUP ---
  if (gameState === 'LOADING') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-8"></div>
          <h2 className="text-3xl font-black text-cyan-400 mb-2 tracking-tighter italic">CARGANDO SENSORES</h2>
          <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">Iniciando protocolo...</p>
        </div>
      </div>
    );
  }

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl rounded-[3rem] p-8 border border-slate-800">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-cyan-500 rounded-full mx-auto mb-6 shadow-[0_0_40px_rgba(6,182,212,0.5)]"></div>
            <h2 className="text-4xl font-black tracking-tighter italic uppercase text-white mb-2">Registro de Piloto</h2>
            <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">Crea tu identidad en el vacío</p>
          </div>
          
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4">
              <img src={profile.avatar} className="w-24 h-24 rounded-full border-4 border-cyan-500 p-1 shadow-2xl" alt="Avatar" />
              <div className="flex gap-2">
                {DEFAULT_AVATARS.map((av, i) => (
                  <button 
                    key={i} 
                    onClick={() => setProfile({...profile, avatar: av})}
                    className={`w-10 h-10 rounded-full overflow-hidden border-2 ${profile.avatar === av ? 'border-cyan-400' : 'border-slate-700'} transition-all`}
                  >
                    <img src={av} alt="Avatar option" className="w-full h-full" />
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="block text-slate-400 text-xs uppercase tracking-widest font-bold mb-2">Nombre del Piloto</label>
              <input 
                type="text" 
                placeholder="Ingresa tu nombre..."
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl text-white font-bold text-center focus:outline-none focus:border-cyan-500 transition-all"
                value={profile.name}
                onChange={(e) => setProfile({...profile, name: e.target.value})}
              />
            </div>
            
            <button 
              onClick={saveProfile}
              disabled={!profile.name.trim()}
              className={`w-full py-5 rounded-2xl font-black text-lg transition-all shadow-2xl ${profile.name.trim() ? 'bg-cyan-500 text-slate-950 hover:scale-105 active:scale-95' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
            >
              INICIAR MISIÓN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- INTERFAZ PRINCIPAL ---
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-4 font-sans select-none overflow-hidden">
      
      {/* HUD SUPERIOR */}
      <div className="w-full max-w-[600px] mb-6 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="flex justify-between items-end mb-4">
          <div className="flex items-center gap-4">
            <img src={profile.avatar} className="w-12 h-12 rounded-full border-2 border-cyan-500 shadow-lg shadow-cyan-500/20" alt="Avatar" />
            <div>
              <h1 className="text-4xl font-black italic tracking-tighter leading-none">ECHO <span className="text-cyan-400">PATH</span></h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Piloto: {profile.name || 'Desconocido'}</p>
            </div>
          </div>
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={`p-3 rounded-2xl border transition-all active:scale-90 ${isMuted ? 'bg-red-500/10 border-red-500/50 text-red-500' : 'bg-slate-900 border-slate-800 text-cyan-400'}`}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9l-5 5H2v-4h2l5 5z"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            )}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <StatBox label="Fase" value={currentLevel + 1} />
          <StatBox label="Vidas" value={lives} highlight={lives < 3} color="text-red-400" />
          <StatBox label="Ecos" value={echoes} highlight={echoes < 5} color="text-cyan-400" />
          <StatBox label="Monedas" value={coins} color="text-amber-400" />
          <StatBox label="Score" value={totalScore} color="text-emerald-400" />
          <StatBox label="Máx Fase" value={maxLevelReached + 1} />
          <div className="col-span-2 bg-slate-900/90 p-4 rounded-3xl border border-slate-800 flex flex-col items-center justify-center">
            <span className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] mb-1">Ranking Global</span>
            <span className="text-2xl font-black tracking-tighter leading-none text-cyan-400">
              #{leaderboard.findIndex(p => p.uid === user?.uid) + 1 || '?'}
            </span>
          </div>
        </div>
      </div>

      {/* ÁREA DE JUEGO */}
      <div className="relative rounded-[3rem] overflow-hidden border-4 border-slate-800 shadow-2xl bg-black">
        <canvas 
          ref={canvasRef} 
          width={CANVAS_SIZE} 
          height={CANVAS_SIZE} 
          className="bg-[#00050a] w-full aspect-square max-w-[600px] cursor-crosshair"
        />

        {/* OVERLAYS */}
        {gameState === 'START' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-12 text-center backdrop-blur-2xl">
            <div className="w-24 h-24 bg-cyan-500 rounded-full mb-10 animate-pulse shadow-[0_0_50px_rgba(6,182,212,0.5)]" />
            <h2 className="text-5xl font-black mb-4 tracking-tighter italic uppercase text-white">Iniciar Secuencia</h2>
            <p className="text-slate-400 mb-10 max-w-xs text-sm leading-relaxed">
              Llaves reubicadas en zonas seguras. Arrastre 1:1 habilitado. Gestión de recursos crítica.
            </p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button 
                onClick={startNewGame}
                className="w-full py-6 bg-white text-slate-950 font-black rounded-3xl hover:bg-cyan-400 transition-all hover:scale-105 active:scale-95 shadow-2xl uppercase tracking-widest text-lg"
              >
                {maxLevelReached > 0 ? `Continuar Fase ${maxLevelReached + 1}` : 'Cargar Sensores'}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setGameState('RANKING')}
                  className="py-4 bg-slate-900 border border-slate-800 rounded-3xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400"><path d="M12 2L15 9l7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>
                  Ranking
                </button>
                <button 
                  onClick={() => setGameState('STORE')}
                  className="py-4 bg-slate-900 border border-slate-800 rounded-3xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                  Tienda
                </button>
              </div>
            </div>

            {rewardActive && (
              <div className="mt-8 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-3xl animate-pulse max-w-xs">
                <p className="text-emerald-400 text-[10px] font-black uppercase mb-1">🎁 Paquete Sorpresa Desbloqueado</p>
                <p className="text-white text-xs font-bold italic">Top 3 detectado. Recompensa disponible</p>
              </div>
            )}
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-red-950/95 flex flex-col items-center justify-center p-10 text-center backdrop-blur-xl animate-in zoom-in duration-300">
            <span className="text-8xl mb-6">⚠️</span>
            <h2 className="text-5xl font-black text-white mb-2 tracking-tighter italic uppercase">Colisión Detectada</h2>
            <p className="text-red-300/60 mb-10 font-bold uppercase tracking-[0.4em] text-xs">Sector {currentLevel + 1} Perdido</p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button 
                onClick={retry}
                className="px-16 py-5 bg-white text-slate-950 font-black rounded-3xl hover:scale-105 transition-all shadow-2xl"
              >
                Reintentar Fase
              </button>
              <button 
                onClick={() => setGameState('START')}
                className="py-3 text-red-300 font-bold uppercase text-xs tracking-widest hover:text-white transition-all"
              >
                Volver al Menú
              </button>
            </div>
          </div>
        )}

        {gameState === 'WIN' && (
          <div className="absolute inset-0 bg-emerald-950/95 flex flex-col items-center justify-center p-10 text-center backdrop-blur-xl">
            <span className="text-8xl mb-6">🏆</span>
            <h2 className="text-5xl font-black text-white mb-2 tracking-tighter italic uppercase">Misión Completada</h2>
            <p className="text-emerald-300/60 mb-10 font-bold uppercase tracking-[0.4em] text-xs">Todos los Sectores Securizados</p>
            <p className="text-white text-2xl font-black mb-6">Score Final: {totalScore}</p>
            <button 
              onClick={() => setGameState('START')}
              className="px-16 py-5 bg-white text-slate-950 font-black rounded-3xl hover:scale-105 transition-all shadow-2xl"
            >
              Volver al Menú
            </button>
          </div>
        )}

        {gameState === 'RANKING' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-8 backdrop-blur-2xl">
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black italic uppercase tracking-tighter">Ranking Global</h2>
                <button 
                  onClick={() => setGameState('START')}
                  className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
              </div>
              
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2 mb-6">
                {leaderboard.map((player, i) => (
                  <div 
                    key={i} 
                    className={`flex items-center justify-between p-4 rounded-3xl border transition-all ${player.uid === user?.uid ? 'bg-cyan-500/10 border-cyan-500/50' : 'bg-slate-900/50 border-slate-800'}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 flex items-center justify-center rounded-full ${i < 3 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'} font-black text-sm`}>
                        {i + 1}
                      </div>
                      <img src={player.avatar} className="w-10 h-10 rounded-full border border-slate-700" alt="Avatar" />
                      <div>
                        <p className="font-black text-sm">{player.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold">Fase {player.level}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-cyan-400">{player.score}</p>
                      <p className="text-[10px] text-slate-500 font-bold">Puntos</p>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="p-4 bg-slate-900/50 rounded-3xl border border-slate-800 text-center">
                <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Población del Vacío: {globalPlayerCount}/100</p>
                {globalPlayerCount < 100 ? (
                  <p className="text-[10px] text-cyan-600 italic font-bold">Llega a 100 jugadores para activar el mercado sorpresa.</p>
                ) : (
                  <p className="text-[10px] text-emerald-500 italic font-bold">¡Protocolo Sorpresa Activo para el Top 3!</p>
                )}
              </div>
            </div>
          </div>
        )}

        {gameState === 'STORE' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-8 backdrop-blur-2xl">
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl font-black italic uppercase tracking-tighter">Tienda</h2>
                <button 
                  onClick={() => setGameState('START')}
                  className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
              </div>
              
              <div className="space-y-4 mb-6">
                <StoreItem 
                  title="10 Ecos" 
                  price="5 Monedas" 
                  onBuy={() => buyWithCoins('echoes', 10, 5)}
                  active={coins >= 5}
                />
                <StoreItem 
                  title="25 Ecos" 
                  price="10 Monedas" 
                  onBuy={() => buyWithCoins('echoes', 25, 10)}
                  active={coins >= 10}
                />
                <StoreItem 
                  title="1 Vida" 
                  price="8 Monedas" 
                  onBuy={() => buyWithCoins('lives', 1, 8)}
                  active={coins >= 8}
                />
                <StoreItem 
                  title="3 Vidas" 
                  price="20 Monedas" 
                  onBuy={() => buyWithCoins('lives', 3, 20)}
                  active={coins >= 20}
                />
              </div>
              
              <div className="p-4 bg-slate-900/50 rounded-3xl border border-slate-800">
                <p className="text-[10px] text-slate-500 font-black uppercase mb-3">Compras Premium</p>
                <div className="space-y-3">
                  <button 
                    onClick={() => buyWithDollars('echoes', 100)}
                    className="w-full p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex justify-between items-center hover:bg-emerald-500/20 transition-all"
                  >
                    <span className="font-black text-emerald-400 text-sm">100 Ecos</span>
                    <span className="bg-emerald-500 text-slate-950 text-[10px] font-black px-3 py-1 rounded-lg">$1.99 USD</span>
                  </button>
                  <button 
                    onClick={() => buyWithDollars('lives', 5)}
                    className="w-full p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex justify-between items-center hover:bg-emerald-500/20 transition-all"
                  >
                    <span className="font-black text-emerald-400 text-sm">5 Vidas</span>
                    <span className="bg-emerald-500 text-slate-950 text-[10px] font-black px-3 py-1 rounded-lg">$0.99 USD</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Premium (Simulado) */}
        {showPremiumModal && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-10 text-center backdrop-blur-md z-50">
            <h3 className="text-3xl font-black text-emerald-400 mb-4 tracking-tighter italic">SUMINISTROS PRO</h3>
            <div className="bg-slate-800 p-6 rounded-3xl border border-emerald-500/30 mb-8">
              <span className="text-6xl block mb-4">📦</span>
              <p className="text-white text-xl font-bold mb-2">+100 Ecos Instantáneos</p>
              <p className="text-slate-400 text-sm">Desbloquea el mapa sin límites.</p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button 
                onClick={() => buyWithDollars('echoes', 100)}
                className="py-4 bg-emerald-500 text-slate-950 font-black rounded-2xl hover:bg-emerald-400 transition-all shadow-lg"
              >
                COMPRAR POR $1.99 USD
              </button>
              <button 
                onClick={() => setShowPremiumModal(false)}
                className="py-3 text-slate-400 font-bold hover:text-white transition-colors"
              >
                Cerrar Tienda
              </button>
            </div>
          </div>
        )}
      </div>

      {/* TIENDA Y CONTROLES INFERIORES */}
      {gameState === 'PLAYING' && (
        <div className="mt-8 flex flex-col items-center gap-6 w-full max-w-[600px]">
          <div className="flex gap-4 w-full">
            <button 
              onClick={() => buyWithCoins('echoes', 15, 10)}
              disabled={coins < 10}
              className={`flex-1 py-5 rounded-3xl font-black flex items-center justify-center gap-4 transition-all shadow-xl ${coins >= 10 ? 'bg-amber-500 text-amber-950 hover:scale-105' : 'bg-slate-900 text-slate-600 opacity-50 cursor-not-allowed border border-slate-800'}`}
            >
              <span className="text-sm tracking-tight uppercase">🛒 +15 Ecos</span>
              <span className="bg-amber-950/20 px-3 py-1 rounded-xl text-[10px] italic">10 MONEDAS</span>
            </button>
            
            <button 
              onClick={() => setShowPremiumModal(true)}
              className="flex-1 py-5 bg-emerald-600 text-white font-black rounded-3xl hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-900/20 flex items-center justify-center gap-2 uppercase text-xs italic tracking-widest"
            >
              <span>✨ Pro Pack</span>
              <span className="text-[10px] bg-emerald-900/30 px-2 py-1 rounded-lg">$1.99</span>
            </button>
          </div>

          <div className="flex items-center gap-6 px-8 py-4 bg-slate-900/50 rounded-full border border-slate-800/50 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Safe Keys Active</span>
            </div>
            <div className="w-[1px] h-5 bg-slate-800" />
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">100 Fases</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- COMPONENTES AUXILIARES ---
const StatBox = ({ label, value, highlight, color = "text-white" }) => (
  <div className={`bg-slate-900/90 p-4 rounded-3xl border transition-all duration-300 ${highlight ? 'border-red-500 animate-pulse' : 'border-slate-800'} flex flex-col items-center shadow-lg`}>
    <span className="text-[9px] text-slate-500 uppercase font-black tracking-[0.2em] mb-1">{label}</span>
    <span className={`text-2xl font-black tracking-tighter leading-none ${color}`}>{value}</span>
  </div>
);

const StoreItem = ({ title, price, onBuy, active = true, premium = false }) => (
  <button 
    onClick={onBuy}
    disabled={!active && !premium}
    className={`flex justify-between items-center p-5 rounded-3xl border transition-all w-full ${premium ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20' : active ? 'bg-slate-900 border-slate-800 hover:bg-slate-800' : 'bg-slate-950 border-slate-900 opacity-40 cursor-not-allowed'}`}
  >
    <div className="flex flex-col items-start">
      <span className={`font-black uppercase text-sm ${premium ? 'text-emerald-400' : 'text-white'}`}>{title}</span>
      <span className="text-[10px] text-slate-600 font-bold">DISPONIBILIDAD INMEDIATA</span>
    </div>
    <span className={`text-[10px] font-black px-4 py-2 rounded-xl italic ${premium ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-400'}`}>{price}</span>
  </button>
);

export default App;
