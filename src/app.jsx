import React, { useState, useEffect, useRef, useMemo } from 'react';

// --- CONFIGURACIÓN Y CONSTANTES ---
const CANVAS_SIZE = 600;
const PLAYER_RADIUS = 12;
const HITBOX_RELAX = 40; 
const INITIAL_ECHOES = 30;

const App = () => {
  const canvasRef = useRef(null);
  
  // Estados de Juego
  const [gameState, setGameState] = useState('START'); // START, PLAYING, GAMEOVER, WIN
  const [currentLevel, setCurrentLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  
  // Recursos y Progreso
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
            setGameState('GAMEOVER');
            playSound(100, 'square', 0.4, 0.2);
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

      // 4. ENEMIGOS (MÓVILES)
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
            setGameState('GAMEOVER');
        }
      });

      // 5. LLAVE Y PORTAL
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

      if (hasKey && Math.hypot(playerPos.current.x - currentLevelData.end.x, playerPos.current.y - currentLevelData.end.y) < 35) {
        if (currentLevel < 99) {
          const next = currentLevel + 1;
          setCurrentLevel(next);
          playerPos.current = levelData[next].start;
          setHasKey(false);
          visibilityMap.current.clear();
          setTotalScore(prev => prev + 250);
          playSound(1100, 'sine', 0.8, 0.2);
        } else {
          setGameState('WIN');
        }
      }

      // 6. JUGADOR
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
  }, [gameState, currentLevel, isMuted, hasKey, echoes]);

  // Controles de Tienda
  const buyWithCoins = () => {
    if (coins >= 10) {
      setCoins(prev => prev - 10);
      setEchoes(prev => prev + 15);
      playSound(700, 'sine', 0.3, 0.2);
    }
  };

  const buyWithDollars = () => {
    // Simulación de transacción premium
    setEchoes(prev => prev + 100);
    setShowPremiumModal(false);
    playSound(1500, 'sine', 0.5, 0.3);
  };

  const retry = () => {
    playerPos.current = levelData[currentLevel].start;
    setHasKey(false);
    visibilityMap.current.clear();
    setGameState('PLAYING');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-4 font-sans select-none overflow-hidden">
      
      {/* HUD SUPERIOR */}
      <div className="w-full max-w-[600px] mb-6 animate-in fade-in slide-in-from-top-4 duration-700">
        <div className="flex justify-between items-end mb-4">
          <div>
            <h1 className="text-4xl font-black italic tracking-tighter leading-none">ECHO <span className="text-cyan-400">PATH</span></h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Operación Fase {currentLevel + 1}</p>
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
          <StatBox label="Nivel" value={currentLevel + 1} />
          <StatBox label="Ecos" value={echoes} highlight={echoes < 5} color="text-cyan-400" />
          <StatBox label="Monedas" value={coins} color="text-amber-400" />
          <StatBox label="Score" value={totalScore} color="text-emerald-400" />
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
            <button 
              onClick={() => { setGameState('PLAYING'); setEchoes(INITIAL_ECHOES); }}
              className="w-full py-6 bg-white text-slate-950 font-black rounded-3xl hover:bg-cyan-400 transition-all hover:scale-105 active:scale-95 shadow-2xl uppercase tracking-widest text-lg"
            >
              Cargar Sensores
            </button>
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-red-950/95 flex flex-col items-center justify-center p-10 text-center backdrop-blur-xl animate-in zoom-in duration-300">
            <span className="text-8xl mb-6">⚠️</span>
            <h2 className="text-5xl font-black text-white mb-2 tracking-tighter italic uppercase font-black">Colisión Detectada</h2>
            <p className="text-red-300/60 mb-10 font-bold uppercase tracking-[0.4em] text-xs">Sector {currentLevel + 1} Perdido</p>
            <button 
              onClick={retry}
              className="px-16 py-5 bg-white text-slate-950 font-black rounded-3xl hover:scale-105 transition-all shadow-2xl"
            >
              Reintentar Fase
            </button>
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
                onClick={buyWithDollars}
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
      <div className="mt-8 flex flex-col items-center gap-6 w-full max-w-[600px]">
        <div className="flex gap-4 w-full">
          <button 
            onClick={buyWithCoins}
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

export default App;

