import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection, getDocs, query 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { Camera, User, Trophy, ShoppingCart, Play, Heart, Coins, Volume2, VolumeX, ArrowLeft } from 'lucide-react';

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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'echo-path-pro-final';

// --- CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 12;
const HITBOX_RELAX = 45;
const INITIAL_LIVES = 10;
const DEFAULT_AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Milo",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Zoe"
];

// --- COMPONENTES AUXILIARES ---
const StatBox = ({ label, value, color, highlight }) => (
    <div className={`bg-slate-900/90 px-3 py-2 rounded-2xl border ${highlight ? 'border-red-500 animate-pulse' : 'border-slate-800'} flex flex-col items-center min-w-[70px]`}>
        <span className="text-[8px] text-slate-600 uppercase font-black">{label}</span>
        <span className={`text-sm font-black ${color || 'text-white'}`}>{value}</span>
    </div>
);

const App = () => {
  const canvasRef = useRef(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({ name: '', avatar: DEFAULT_AVATARS[0] });
  const [isProfileSet, setIsProfileSet] = useState(false);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('LOADING'); // LOADING, SETUP, MENU, PLAYING, GAMEOVER, STORE, RANKING
  const [currentLevel, setCurrentLevel] = useState(0);
  const [maxLevelReached, setMaxLevelReached] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  // Recursos y Ranking
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [echoes, setEchoes] = useState(30);
  const [coins, setCoins] = useState(0);
  const [hasKey, setHasKey] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [globalPlayerCount, setGlobalPlayerCount] = useState(0);

  // Refs de Motor
  const playerPos = useRef({ x: 70, y: 70 });
  const pulses = useRef([]);
  const visibilityMap = useRef(new Map());
  const isDragging = useRef(false);
  const audioCtx = useRef(null);
  const masterGain = useRef(null);

  // --- LOGICA DE FIREBASE ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        const u = await signInAnonymously(auth);
        setUser(u.user);
      } catch (err) { console.error("Auth Error", err); }
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
        setGameState('MENU');
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
    setGameState('MENU');
  };

  const syncProgress = async (lvl, score, cns) => {
    if (!user) return;
    const statsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'stats');
    const leadRef = doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', user.uid);
    
    await setDoc(statsRef, { maxLevel: Math.max(maxLevelReached, lvl), coins: cns }, { merge: true });
    await setDoc(leadRef, { score, level: lvl + 1 }, { merge: true });
  };

  // --- GENERADOR DE NIVELES ---
  const levels = useMemo(() => {
    return Array.from({ length: 100 }, (_, i) => {
      const diff = i / 100;
      const walls = [
        { x: 0, y: 0, w: CANVAS_SIZE, h: 20, id: `b-t-${i}` },
        { x: 0, y: 580, w: CANVAS_SIZE, h: 20, id: `b-b-${i}` },
        { x: 0, y: 0, w: 20, h: CANVAS_SIZE, id: `b-l-${i}` },
        { x: 580, y: 0, w: 20, h: CANVAS_SIZE, id: `b-r-${i}` }
      ];
      for(let j=0; j < 10 + Math.floor(diff*25); j++) {
        walls.push({ x: 100+Math.random()*350, y: 100+Math.random()*350, w: 30+Math.random()*70, h: 30+Math.random()*70, id: `w-${i}-${j}` });
      }
      return {
        id: i,
        title: (i+1)%10===0 ? `ALERTA SECTOR ${i+1}` : `FASE ${i+1}`,
        walls,
        movingWalls: i > 5 ? [{ x: 300, y: 300, w: 30, h: 30, vx: 5+diff*10, vy: 5+diff*10, id: `m-${i}` }] : [],
        coins: Array.from({length: 6}, (_, k) => ({ x: 80+Math.random()*440, y: 80+Math.random()*440, id: `c-${i}-${k}` })),
        start: { x: 70, y: 70 },
        end: { x: 530, y: 530 },
        key: { x: 120+Math.random()*360, y: 120+Math.random()*360 }
      };
    });
  }, []);

  const playSound = (freq, type = 'sine', duration = 0.2, vol = 0.1) => {
    if (isMuted) return;
    if (!audioCtx.current) {
        audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
        masterGain.current = audioCtx.current.createGain();
        masterGain.current.connect(audioCtx.current.destination);
    }
    try {
        const osc = audioCtx.current.createOscillator();
        const g = audioCtx.current.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
        g.gain.setValueAtTime(vol, audioCtx.current.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.current.currentTime + duration);
        osc.connect(g); g.connect(masterGain.current);
        osc.start(); osc.stop(audioCtx.current.currentTime + duration);
    } catch (e) {}
  };

  // --- MOTOR DE JUEGO ---
  useEffect(() => {
    if (gameState !== 'PLAYING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let frame;
    const lvl = levels[currentLevel];

    const handleInput = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      const x = (clientX - rect.left) * (CANVAS_SIZE / rect.width);
      const y = (clientY - rect.top) * (CANVAS_SIZE / rect.height);
      const dist = Math.hypot(x - playerPos.current.x, y - playerPos.current.y);

      if (dist < HITBOX_RELAX) isDragging.current = true;
      else if (echoes > 0) {
        pulses.current.push({ x, y, r: 0, maxR: 500, alpha: 1 });
        setEchoes(v => v - 1); playSound(440);
      }
    };

    const handleMove = (e) => {
      if (!isDragging.current) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      playerPos.current = { x: (clientX - rect.left) * (CANVAS_SIZE / rect.width), y: (clientY - rect.top) * (CANVAS_SIZE / rect.height) };
    };

    canvas.addEventListener('mousedown', handleInput);
    canvas.addEventListener('touchstart', handleInput, {passive: false});
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, {passive: false});
    const release = () => isDragging.current = false;
    window.addEventListener('mouseup', release); window.addEventListener('touchend', release);

    const render = () => {
      ctx.fillStyle = '#010409'; ctx.fillRect(0,0,600,600);
      pulses.current = pulses.current.filter(p => p.r < p.maxR);
      pulses.current.forEach(p => {
        p.r += 14; p.alpha *= 0.94;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${p.alpha})`; ctx.stroke();
        const reveal = (obj, isC = false) => {
          const d = isC ? Math.hypot(p.x-obj.x, p.y-obj.y) : Math.hypot(p.x-Math.max(obj.x, Math.min(p.x, obj.x+obj.w)), p.y-Math.max(obj.y, Math.min(p.y, obj.y+obj.h)));
          if(Math.abs(d - p.r) < 25) visibilityMap.current.set(obj.id || 'key', 1);
        };
        lvl.walls.forEach(reveal); lvl.coins.forEach(c => reveal(c, true));
        lvl.movingWalls.forEach(reveal); reveal(lvl.key, true);
      });
      lvl.walls.forEach(w => {
        const op = visibilityMap.current.get(w.id) || 0;
        if(op > 0) { ctx.fillStyle = `rgba(34, 211, 238, ${op})`; ctx.fillRect(w.x, w.y, w.w, w.h); visibilityMap.current.set(w.id, op-0.01); }
        if(Math.hypot(playerPos.current.x - Math.max(w.x, Math.min(playerPos.current.x, w.x+w.w)), playerPos.current.y - Math.max(w.y, Math.min(playerPos.current.y, w.y+w.h))) < PLAYER_RADIUS-2) {
            setLives(l => {
                if (l-1 <= 0) { setGameState('GAMEOVER'); return 0; }
                playerPos.current = lvl.start; visibilityMap.current.clear();
                return l - 1;
            });
            playSound(100, 'square');
        }
      });
      lvl.coins.forEach(c => {
        if(c.collected) return;
        const op = visibilityMap.current.get(c.id) || 0;
        if(op > 0) { ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI*2); ctx.fillStyle=`rgba(251,191,36,${op})`; ctx.fill(); visibilityMap.current.set(c.id, op-0.005); }
        if(Math.hypot(playerPos.current.x-c.x, playerPos.current.y-c.y) < 20) { c.collected=true; setCoins(v => v+1); setTotalScore(s => s+50); playSound(1200); }
      });
      if(!hasKey) {
        const op = visibilityMap.current.get('key') || 0;
        if(op > 0) { ctx.beginPath(); ctx.arc(lvl.key.x, lvl.key.y, 14, 0, Math.PI*2); ctx.strokeStyle=`rgba(34,211,238,${op})`; ctx.stroke(); visibilityMap.current.set('key', op-0.005); }
        if(Math.hypot(playerPos.current.x-lvl.key.x, playerPos.current.y-lvl.key.y) < 25) { setHasKey(true); playSound(880); }
      }
      ctx.beginPath(); ctx.arc(lvl.end.x, lvl.end.y, 32, 0, Math.PI*2);
      ctx.strokeStyle = hasKey ? '#fbbf24' : '#1e293b'; ctx.lineWidth=6; ctx.stroke();
      if(hasKey && Math.hypot(playerPos.current.x-lvl.end.x, playerPos.current.y-lvl.end.y) < 35) {
        const next = currentLevel + 1;
        if (next >= 100) setGameState('WIN');
        else { setCurrentLevel(next); setMaxLevelReached(m => Math.max(m, next)); setHasKey(false); visibilityMap.current.clear(); playerPos.current = levels[next].start; setTotalScore(s => s+250); syncProgress(next, totalScore+250, coins); playSound(1100); }
      }
      ctx.beginPath(); ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI*2);
      ctx.fillStyle = '#fff'; ctx.fill();
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [gameState, currentLevel, hasKey, echoes]);

  const isTop3 = leaderboard.slice(0, 3).some(p => p.uid === user?.uid);
  const rewardActive = globalPlayerCount >= 100 && isTop3;

  // --- INTERFAZ ---
  if (gameState === 'LOADING') return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-cyan-400 font-black animate-pulse uppercase tracking-[0.5em]">Iniciando Protocolo...</div>;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-4 font-sans select-none overflow-hidden">
      
      {/* HUD SUPERIOR */}
      <div className="w-full max-w-[600px] mb-4 space-y-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={profile.avatar} className="w-10 h-10 rounded-full border-2 border-cyan-500 shadow-lg shadow-cyan-500/20" alt="Avatar" />
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-black leading-none">Piloto</p>
              <p className="text-sm font-black text-white italic">{profile.name || 'Desconocido'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <StatBox label="Vidas" value={lives} color="text-red-500" highlight={lives < 3} />
            <StatBox label="Monedas" value={coins} color="text-amber-400" />
            <StatBox label="Score" value={totalScore} color="text-cyan-400" />
          </div>
        </div>
      </div>

      <div className="relative rounded-[3rem] overflow-hidden border-4 border-slate-800 shadow-2xl bg-black">
        <canvas ref={canvasRef} width={600} height={600} className="bg-[#00050a] w-full aspect-square max-w-[600px] cursor-crosshair" />

        {/* SETUP: Nombre y Avatar */}
        {gameState === 'SETUP' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-8 backdrop-blur-3xl">
            <Trophy className="text-cyan-400 w-16 h-16 mb-6" />
            <h2 className="text-3xl font-black mb-2 italic uppercase">Registro de Piloto</h2>
            <p className="text-slate-500 text-xs mb-8 uppercase tracking-widest">Crea tu identidad en el vacío</p>
            
            <div className="w-full max-w-xs space-y-6">
              <div className="flex flex-col items-center gap-4">
                <img src={profile.avatar} className="w-24 h-24 rounded-full border-4 border-cyan-500 p-1" alt="Preview" />
                <div className="flex gap-2">
                  {DEFAULT_AVATARS.map((av, i) => (
                    <button key={i} onClick={() => setProfile({...profile, avatar: av})} className="w-8 h-8 rounded-full overflow-hidden border border-slate-700 hover:border-cyan-400">
                      <img src={av} alt="option" />
                    </button>
                  ))}
                  <label className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center cursor-pointer border border-slate-700 hover:border-white">
                    <Camera size={14} />
                    <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                      const file = e.target.files[0];
                      if(file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setProfile({...profile, avatar: reader.result});
                        reader.readAsDataURL(file);
                      }
                    }} />
                  </label>
                </div>
              </div>

              <input 
                type="text" 
                placeholder="Nombre del Avatar..."
                className="w-full bg-slate-900 border border-slate-800 p-4 rounded-2xl text-center font-bold text-white focus:outline-none focus:border-cyan-500"
                value={profile.name}
                onChange={(e) => setProfile({...profile, name: e.target.value})}
              />
              
              <button onClick={saveProfile} className="w-full py-4 bg-cyan-500 text-slate-950 font-black rounded-2xl shadow-xl shadow-cyan-900/40 uppercase tracking-widest">Finalizar Registro</button>
            </div>
          </div>
        )}

        {/* MENU PRINCIPAL */}
        {gameState === 'MENU' && (
          <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center p-12 text-center backdrop-blur-2xl">
            <h2 className="text-5xl font-black mb-10 italic uppercase tracking-tighter">ECHO <span className="text-cyan-400">PATH</span></h2>
            
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button onClick={() => { setCurrentLevel(maxLevelReached); playerPos.current = levels[maxLevelReached].start; setGameState('PLAYING'); }} className="py-5 bg-cyan-500 text-slate-950 font-black rounded-3xl hover:scale-105 transition-all shadow-xl shadow-cyan-900/40 flex items-center justify-center gap-3">
                <Play fill="currentColor" size={20} /> CONTINUAR FASE {maxLevelReached + 1}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setGameState('RANKING')} className="py-4 bg-slate-900 border border-slate-800 rounded-3xl flex items-center justify-center gap-2 text-xs font-bold hover:bg-slate-800"><Trophy size={14} className="text-amber-400" /> RANKING</button>
                <button onClick={() => setGameState('STORE')} className="py-4 bg-slate-900 border border-slate-800 rounded-3xl flex items-center justify-center gap-2 text-xs font-bold hover:bg-slate-800"><ShoppingCart size={14} className="text-cyan-400" /> TIENDA</button>
              </div>
              <button onClick={() => { setCurrentLevel(0); setTotalScore(0); setLives(10); setEchoes(30); setGameState('PLAYING'); }} className="py-3 text-slate-500 font-bold uppercase text-[10px] tracking-widest hover:text-white transition-all underline underline-offset-4">Iniciar Nueva Partida</button>
            </div>

            {rewardActive && (
              <div className="mt-8 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-3xl animate-pulse">
                <p className="text-emerald-400 text-[10px] font-black uppercase mb-1">🎁 Paquete Sorpresa Desbloqueado</p>
                <p className="text-white text-xs font-bold italic">Top 3 detectado. Venta de monedas activa ($0.001 USD x Moneda)</p>
                <button onClick={() => alert(`Transacción procesada: Has vendido tus monedas por $${(coins * 0.001).toFixed(2)} USD (Simulación)`)} className="mt-3 py-2 px-6 bg-emerald-500 text-slate-950 text-[10px] font-black rounded-xl">REDIMIR AHORA</button>
              </div>
            )}
          </div>
        )}

        {/* RANKING GLOBAL */}
        {gameState === 'RANKING' && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col p-8 backdrop-blur-2xl">
            <div className="flex items-center gap-4 mb-8">
              <button onClick={() => setGameState('MENU')} className="p-3 bg-slate-900 rounded-2xl"><ArrowLeft size={20} /></button>
              <h2 className="text-2xl font-black italic uppercase">Muro de Honor</h2>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-hide">
              {leaderboard.map((player, i) => (
                <div key={i} className={`flex items-center justify-between p-4 rounded-3xl border ${player.uid === user.uid ? 'bg-cyan-500/10 border-cyan-500/50' : 'bg-slate-900 border-slate-800'}`}>
                  <div className="flex items-center gap-4">
                    <span className={`text-sm font-black w-6 ${i < 3 ? 'text-amber-400' : 'text-slate-500'}`}>{i + 1}</span>
                    <img src={player.avatar} className="w-10 h-10 rounded-full border border-slate-700" alt="av" />
                    <div>
                      <p className="font-black text-sm">{player.name}</p>
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Fase {player.level}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-cyan-400 leading-none">{player.score}</p>
                    <p className="text-[8px] text-slate-600 font-bold uppercase">Puntos</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-slate-900/50 rounded-3xl border border-slate-800 text-center">
               <p className="text-[10px] text-slate-500 font-black uppercase">Población del Vacío: {globalPlayerCount}/100</p>
               {globalPlayerCount < 100 ? (
                 <p className="text-[9px] text-cyan-600 italic mt-1 font-bold">Llega a 100 jugadores para activar el mercado sorpresa.</p>
               ) : (
                 <p className="text-[9px] text-emerald-500 italic mt-1 font-bold">¡Protocolo Sorpresa Activo para el Top 3!</p>
               )}
            </div>
          </div>
        )}

        {/* TIENDA */}
        {gameState === 'STORE' && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col p-8 backdrop-blur-2xl">
            <div className="flex items-center gap-4 mb-8">
              <button onClick={() => setGameState('MENU')} className="p-3 bg-slate-900 rounded-2xl"><ArrowLeft size={20} /></button>
              <h2 className="text-2xl font-black italic uppercase">Suministros</h2>
            </div>
            
            <div className="space-y-4">
               <StoreItem title="10 Ecos" price="5 Monedas" onBuy={() => { if(coins >= 5){ setCoins(c=>c-5); setEchoes(e=>e+10); playSound(700); }}} active={coins >= 5} />
               <StoreItem title="30 Ecos" price="12 Monedas" onBuy={() => { if(coins >= 12){ setCoins(c=>c-12); setEchoes(e=>e+30); playSound(800); }}} active={coins >= 12} />
               <StoreItem title="1 Vida" price="15 Monedas" onBuy={() => { if(coins >= 15){ setCoins(c=>c-15); setLives(l=>l+1); playSound(900); }}} active={coins >= 15} />
               <div className="h-[1px] bg-slate-800 my-2" />
               <StoreItem title="Pack de 100 Ecos" price="$1.99 USD" onBuy={() => { setEchoes(e=>e+100); playSound(1500); }} premium />
               <StoreItem title="Pack de 5 Vidas" price="$0.99 USD" onBuy={() => { setLives(l=>l+5); playSound(1500); }} premium />
            </div>
          </div>
        )}

        {/* GAME OVER */}
        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-red-950/95 flex flex-col items-center justify-center p-12 text-center">
            <h2 className="text-5xl font-black mb-4 italic uppercase tracking-tighter">Impacto fatal</h2>
            <p className="text-red-200/60 mb-10 font-bold text-xs uppercase tracking-widest italic">Tus sensores se han desconectado por falta de integridad física.</p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button onClick={() => { if(lives > 0) setGameState('PLAYING'); else setGameState('STORE'); }} className="py-5 bg-white text-slate-950 font-black rounded-3xl uppercase tracking-widest text-sm shadow-xl hover:scale-105 transition-all">Reconectar Sistema</button>
              <button onClick={() => setGameState('MENU')} className="py-3 text-red-300 font-bold uppercase text-[10px] tracking-widest hover:text-white transition-all underline">Abandonar Fase</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-center w-full max-w-[600px]">
          <button onClick={() => setGameState('MENU')} className="px-8 py-4 bg-slate-900 border border-slate-800 text-slate-500 font-bold rounded-2xl text-[10px] uppercase tracking-widest hover:text-white transition-all flex items-center gap-3">
            {isMuted ? <VolumeX size={14}/> : <Volume2 size={14}/>} {isMuted ? "SISTEMA SILENCIADO" : "SONIDO ACTIVO"}
          </button>
      </div>
    </div>
  );
};

const StoreItem = ({ title, price, onBuy, active = true, premium = false }) => (
    <button 
        onClick={onBuy}
        disabled={!active && !premium}
        className={`flex justify-between items-center p-5 rounded-3xl border transition-all w-full max-w-sm mx-auto ${premium ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20' : active ? 'bg-slate-900 border-slate-800 hover:bg-slate-800' : 'bg-slate-950 border-slate-900 opacity-40 cursor-not-allowed'}`}
    >
        <div className="flex flex-col items-start">
            <span className={`font-black uppercase text-xs ${premium ? 'text-emerald-400' : 'text-white'}`}>{title}</span>
            <span className="text-[9px] text-slate-600 font-bold">DISPONIBILIDAD INMEDIATA</span>
        </div>
        <span className={`text-[10px] font-black px-4 py-2 rounded-xl italic ${premium ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-400'}`}>{price}</span>
    </button>
);

export default App;

