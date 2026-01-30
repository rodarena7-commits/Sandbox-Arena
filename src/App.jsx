import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "", // Se asume provista por el entorno
  authDomain: "playmobil-2d74d.firebaseapp.com",
  projectId: "playmobil-2d74d",
  storageBucket: "playmobil-2d74d.firebasestorage.app",
  messagingSenderId: "85202851148",
  appId: "1:85202851148:web:bf8eba63238c06c7b4ebe9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'echo-path-pro-final';

// --- CONFIGURACIÓN Y CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 12;
const HITBOX_RELAX = 40;
const INITIAL_LIVES = 5;
const INITIAL_ECHOES = 30;
const RESPAWN_COST = 20;
const RESPAWN_TIMER = 30; 

// Avatares estilo dibujos animados (Adventurer de DiceBear)
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
  
  // Recursos
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [echoes, setEchoes] = useState(INITIAL_ECHOES);
  const [coins, setCoins] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  
  // Respawn
  const [respawnTimeLeft, setRespawnTimeLeft] = useState(RESPAWN_TIMER);
  const [showRespawnOptions, setShowRespawnOptions] = useState(false);

  // Referencias de motor
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const projectiles = useRef([]);
  const lastProjectileSpawn = useRef(0);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const audioCtx = useRef(null);
  const masterGain = useRef(null);
  const respawnTimerRef = useRef(null);

  // --- FIREBASE INIT ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        const u = await signInAnonymously(auth);
        setUser(u.user);
      } catch (err) { 
        setGameState('START');
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

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

    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    getDoc(statsRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setMaxLevelReached(data.maxLevel || 0);
        setCoins(data.coins || 0);
        setTotalScore(data.score || 0);
      }
    });

    const rankingRef = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubRanking = onSnapshot(rankingRef, (snap) => {
      const docs = snap.docs.map(d => d.data()).sort((a, b) => b.score - a.score);
      setLeaderboard(docs);
    }, (err) => console.error(err));

    return () => unsubRanking();
  }, [user]);

  const saveProfile = async () => {
    if (!profile.name || !user) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
    await setDoc(profileRef, profile);
    
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile({ ...profile, avatar: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  // --- GENERADOR DE NIVELES ---
  const levelData = useMemo(() => {
    return Array.from({ length: 100 }, (_, i) => {
      const diff = i / 100;
      const walls = [
        { x: 0, y: 0, w: CANVAS_SIZE, h: 20, id: `b-t-${i}` },
        { x: 0, y: CANVAS_SIZE - 20, w: CANVAS_SIZE, h: 20, id: `b-b-${i}` },
        { x: 0, y: 0, w: 20, h: CANVAS_SIZE, id: `b-l-${i}` },
        { x: CANVAS_SIZE - 20, y: 0, w: 20, h: CANVAS_SIZE, id: `b-r-${i}` }
      ];
      
      const wallCount = 8 + Math.floor(diff * 20);
      for (let j = 0; j < wallCount; j++) {
        walls.push({
          x: 100 + Math.random() * 380,
          y: 100 + Math.random() * 380,
          w: 30 + Math.random() * 60,
          h: 30 + Math.random() * 60,
          id: `w-${i}-${j}`
        });
      }

      return {
        id: i,
        walls,
        coins: Array.from({ length: 5 }, (_, j) => ({ x: 100 + Math.random() * 400, y: 100 + Math.random() * 400, id: `c-${i}-${j}`, collected: false })),
        start: { x: 70, y: 70 },
        end: { x: 530, y: 530 },
        key: { x: 150 + Math.random() * 300, y: 150 + Math.random() * 300 }
      };
    });
  }, []);

  // --- AUDIO ---
  const playSound = (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
    if (isMuted) return;
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
  };

  // --- GAME LOOP ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrame;
    const currentLevelData = levelData[currentLevel];

    const spawnProjectile = () => {
      const side = Math.floor(Math.random() * 4); // 0: Top, 1: Right, 2: Bottom, 3: Left
      const speed = 3 + (currentLevel * 0.1);
      let x, y, vx, vy;

      if (side === 0) { x = Math.random() * CANVAS_SIZE; y = -20; vx = 0; vy = speed; }
      else if (side === 1) { x = CANVAS_SIZE + 20; y = Math.random() * CANVAS_SIZE; vx = -speed; vy = 0; }
      else if (side === 2) { x = Math.random() * CANVAS_SIZE; y = CANVAS_SIZE + 20; vx = 0; vy = -speed; }
      else { x = -20; y = Math.random() * CANVAS_SIZE; vx = speed; vy = 0; }

      projectiles.current.push({ x, y, vx, vy, id: Math.random() });
    };

    const handleInputDown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || e.touches?.[0].clientX;
      const clientY = e.clientY || e.touches?.[0].clientY;
      const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
      const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);

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
      const clientX = e.clientX || e.touches?.[0].clientX;
      const clientY = e.clientY || e.touches?.[0].clientY;
      const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
      const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
      playerPos.current = { x, y };
    };

    const handleInputUp = () => isDragging.current = false;

    canvas.addEventListener('mousedown', handleInputDown);
    canvas.addEventListener('touchstart', handleInputDown);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('touchmove', handleInputMove);
    window.addEventListener('mouseup', handleInputUp);
    window.addEventListener('touchend', handleInputUp);

    const render = (time) => {
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Spawn proyectiles
      if (time - lastProjectileSpawn.current > Math.max(500, 2000 - currentLevel * 50)) {
        spawnProjectile();
        lastProjectileSpawn.current = time;
      }

      // 1. Pulsos de Eco
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 10;
        p.alpha *= 0.96;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`;
        ctx.stroke();

        const reveal = (obj, isCircle = false) => {
          let d = isCircle ? Math.hypot(p.x - obj.x, p.y - obj.y) : Math.hypot(p.x - Math.max(obj.x, Math.min(p.x, obj.x + obj.w)), p.y - Math.max(obj.y, Math.min(p.y, obj.y + obj.h)));
          if (Math.abs(d - p.r) < 30) visibilityMap.current.set(obj.id || 'key', 1);
        };
        currentLevelData.walls.forEach(w => reveal(w));
        currentLevelData.coins.forEach(c => reveal(c, true));
        reveal(currentLevelData.key, true);
      });

      // 2. Proyectiles (Flechas)
      projectiles.current = projectiles.current.filter(p => p.x > -50 && p.x < CANVAS_SIZE + 50 && p.y > -50 && p.y < CANVAS_SIZE + 50);
      projectiles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();

        if (Math.hypot(playerPos.current.x - p.x, playerPos.current.y - p.y) < PLAYER_RADIUS + 6) {
          handleCollision();
        }
      });

      // 3. Muros
      currentLevelData.walls.forEach(w => {
        const op = visibilityMap.current.get(w.id) || 0;
        if (op > 0) {
          ctx.fillStyle = `rgba(34, 211, 238, ${op})`;
          ctx.fillRect(w.x, w.y, w.w, w.h);
          visibilityMap.current.set(w.id, op - 0.01);
        }
        const cx = Math.max(w.x, Math.min(playerPos.current.x, w.x + w.w));
        const cy = Math.max(w.y, Math.min(playerPos.current.y, w.y + w.h));
        if (Math.hypot(playerPos.current.x - cx, playerPos.current.y - cy) < PLAYER_RADIUS - 2) {
          handleCollision();
        }
      });

      // 4. Objetos
      currentLevelData.coins.forEach(c => {
        if (c.collected) return;
        const op = visibilityMap.current.get(c.id) || 0;
        if (op > 0) {
          ctx.fillStyle = `rgba(251, 191, 36, ${op})`;
          ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.fill();
          visibilityMap.current.set(c.id, op - 0.005);
        }
        if (Math.hypot(playerPos.current.x - c.x, playerPos.current.y - c.y) < 20) {
          c.collected = true; setCoins(v => v + 1); playSound(1000, 'sine', 0.1, 0.1);
        }
      });

      if (!hasKey) {
        const op = visibilityMap.current.get('key') || 0;
        if (op > 0) {
          ctx.fillStyle = `rgba(34, 211, 238, ${op})`;
          ctx.font = '20px Arial'; ctx.textAlign = 'center'; ctx.fillText('🔑', currentLevelData.key.x, currentLevelData.key.y);
          visibilityMap.current.set('key', op - 0.005);
        }
        if (Math.hypot(playerPos.current.x - currentLevelData.key.x, playerPos.current.y - currentLevelData.key.y) < 20) {
          setHasKey(true); playSound(800, 'triangle', 0.3, 0.2);
        }
      }

      // Portal
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(currentLevelData.end.x, currentLevelData.end.y, 30, 0, Math.PI * 2); ctx.stroke();
      if (hasKey && Math.hypot(playerPos.current.x - currentLevelData.end.x, playerPos.current.y - currentLevelData.end.y) < 30) {
        nextLevel();
      }

      // Jugador (Avatar)
      ctx.save();
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.clip();
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
          setShowRespawnOptions(false);
          startRespawnTimer();
        } else {
          playerPos.current = { ...currentLevelData.start };
          visibilityMap.current.clear();
          projectiles.current = [];
          playSound(150, 'square', 0.3, 0.2);
        }
        return Math.max(0, next);
      });
    };

    const nextLevel = () => {
      const nextLvl = currentLevel + 1;
      setCurrentLevel(nextLvl);
      setMaxLevelReached(m => Math.max(m, nextLvl));
      setTotalScore(s => s + 500);
      setHasKey(false);
      visibilityMap.current.clear();
      projectiles.current = [];
      playerPos.current = { ...levelData[nextLvl].start };
      playSound(1200, 'sine', 0.5, 0.2);
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
  }, [gameState, currentLevel, hasKey, echoes, profile.avatar]);

  const startRespawnTimer = () => {
    if (respawnTimerRef.current) clearInterval(respawnTimerRef.current);
    respawnTimerRef.current = setInterval(() => {
      setRespawnTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(respawnTimerRef.current);
          setShowRespawnOptions(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const buyLife = () => {
    if (coins >= RESPAWN_COST) {
      setCoins(c => c - RESPAWN_COST);
      setLives(1);
      setGameState('PLAYING');
      playerPos.current = { ...levelData[currentLevel].start };
    }
  };

  const restartFrom1 = () => {
    setCurrentLevel(0);
    setLives(INITIAL_LIVES);
    setEchoes(INITIAL_ECHOES);
    setGameState('PLAYING');
    setHasKey(false);
    playerPos.current = { ...levelData[0].start };
    visibilityMap.current.clear();
  };

  if (gameState === 'LOADING') return <div className="h-screen bg-slate-950 flex items-center justify-center text-cyan-400 font-bold">CARGANDO SISTEMA...</div>;

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-[2rem] border border-slate-800 w-full max-w-md text-center">
          <h2 className="text-3xl font-black text-white mb-6 italic uppercase tracking-tighter">Perfil de Piloto</h2>
          <div className="mb-6 flex flex-col items-center">
            <img src={profile.avatar} className="w-24 h-24 rounded-full border-4 border-cyan-500 mb-4 object-cover" alt="Avatar" />
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {DEFAULT_AVATARS.map((av, i) => (
                <button key={i} onClick={() => setProfile({ ...profile, avatar: av })} className="w-10 h-10 rounded-full border-2 border-slate-700 overflow-hidden"><img src={av} alt="opt" /></button>
              ))}
              <button onClick={() => fileInputRef.current.click()} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-xl border-2 border-dashed border-slate-600">📷</button>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
            </div>
            <input 
              type="text" 
              placeholder="Nombre del piloto..." 
              className="w-full p-4 bg-slate-950 rounded-xl text-white font-bold text-center border border-slate-800 focus:border-cyan-500 outline-none"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <button onClick={saveProfile} className="w-full py-4 bg-cyan-500 text-slate-950 font-black rounded-xl hover:scale-105 transition-all">EMPEZAR</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans select-none overflow-hidden">
      
      {/* HUD */}
      <div className="w-full max-w-[600px] mb-4 grid grid-cols-4 gap-2">
        <div className="bg-slate-900 p-2 rounded-xl text-center border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Fase</div>
            <div className="text-xl font-black">{currentLevel + 1}</div>
        </div>
        <div className="bg-slate-900 p-2 rounded-xl text-center border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Vidas</div>
            <div className={`text-xl font-black ${lives < 2 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{lives}</div>
        </div>
        <div className="bg-slate-900 p-2 rounded-xl text-center border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Ecos</div>
            <div className="text-xl font-black text-cyan-400">{echoes}</div>
        </div>
        <div className="bg-slate-900 p-2 rounded-xl text-center border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Monedas</div>
            <div className="text-xl font-black text-amber-400">{coins}</div>
        </div>
      </div>

      <div className="relative rounded-[2rem] overflow-hidden border-4 border-slate-800 shadow-2xl">
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} className="w-full aspect-square max-w-[600px] bg-slate-950" />

        {gameState === 'START' && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
            <h1 className="text-5xl font-black italic tracking-tighter mb-2">ECHO <span className="text-cyan-400">PATH</span> PRO</h1>
            <p className="text-slate-400 mb-8 max-w-xs">Sobrevive a las flechas y encuentra la salida en la oscuridad.</p>
            <button onClick={() => setGameState('PLAYING')} className="px-12 py-5 bg-cyan-500 text-slate-950 font-black rounded-2xl hover:scale-110 transition-all text-xl shadow-[0_0_30px_rgba(6,182,212,0.4)]">INICIAR MISIÓN</button>
            <div className="mt-8 flex gap-4">
               <img src={profile.avatar} className="w-12 h-12 rounded-full border-2 border-cyan-500" />
               <div className="text-left"><div className="text-xs text-slate-500">Piloto actual</div><div className="font-bold">{profile.name}</div></div>
            </div>
          </div>
        )}

        {gameState === 'RESPAWN' && (
          <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-lg flex flex-col items-center justify-center p-8 text-center">
            <div className="text-6xl mb-4">🛸</div>
            <h2 className="text-4xl font-black text-white mb-2 italic">SISTEMA DAÑADO</h2>
            
            {!showRespawnOptions ? (
              <div className="mt-4">
                <p className="text-slate-400 mb-2 uppercase tracking-widest text-xs font-bold">Reconfigurando sensores en...</p>
                <div className="text-6xl font-black text-cyan-400 animate-pulse">{respawnTimeLeft}s</div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 w-full max-w-xs mt-6">
                <button 
                  onClick={buyLife}
                  disabled={coins < RESPAWN_COST}
                  className={`py-4 rounded-xl font-black text-lg transition-all ${coins >= RESPAWN_COST ? 'bg-amber-500 text-slate-950 hover:scale-105' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                >
                  {coins >= RESPAWN_COST ? `COMPRAR VIDA (${RESPAWN_COST} 🪙)` : `FALTAN ${RESPAWN_COST - coins} MONEDAS`}
                </button>
                <button onClick={restartFrom1} className="py-4 bg-slate-100 text-slate-950 font-black rounded-xl hover:scale-105 transition-all">VOLVER AL NIVEL 1</button>
                <button onClick={() => setGameState('START')} className="py-4 bg-red-600/20 text-red-400 border border-red-500/30 font-black rounded-xl hover:bg-red-600/30">SALIR AL MENÚ</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em]">Arrestre al piloto para mover • Toque el vacío para usar ECO</div>
    </div>
  );
};

export default App;

