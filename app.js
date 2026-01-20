import React, { useState, useEffect, useCallback } from 'react';
import { 
  Settings, 
  Play, 
  Plus, 
  Trash2, 
  Save, 
  ChevronLeft, 
  ChevronRight, 
  Brain, 
  Skull,
  Shield,
  Flag,
  Timer,
  Heart,
  Swords,
  Target,
  Home,
  Zap
} from 'lucide-react';

// --- CONFIGURACIÓN DE TIPOS DE BLOQUES CON IMÁGENES ---
const TILE_TYPES = {
  EMPTY: 'empty',
  WALL: 'wall',
  ZOMBIE: 'zombie',
  ROCK: 'rock',
  BOX: 'box',
  GRASS: 'grass',
  WATER: 'water',
  RIFLE: 'rifle',
  SHOTGUN: 'shotgun',
  KEY: 'key',
  PORTAL: 'portal',
  START: 'start',
  EXIT: 'exit'
};

const TILE_DATA = {
  [TILE_TYPES.EMPTY]: { 
    color: 'bg-slate-800', 
    label: 'Vacíos', 
    icon: null,
    image: null 
  },
  [TILE_TYPES.WALL]: { 
    color: 'bg-amber-900', 
    label: 'Ladrillo', 
    icon: null,
    image: 'ladrillo.png' 
  },
  [TILE_TYPES.ZOMBIE]: { 
    color: 'bg-red-800', 
    label: 'Zombie', 
    icon: <Skull size={16} className="text-white" />,
    image: 'zombie.png' 
  },
  [TILE_TYPES.ROCK]: { 
    color: 'bg-gray-500', 
    label: 'Roca', 
    icon: null,
    image: 'roca.png' 
  },
  [TILE_TYPES.BOX]: { 
    color: 'bg-yellow-800', 
    label: 'Caja', 
    icon: null,
    image: 'caja.png' 
  },
  [TILE_TYPES.GRASS]: { 
    color: 'bg-green-700', 
    label: 'Pastizal', 
    icon: null,
    image: 'pastizal.png' 
  },
  [TILE_TYPES.WATER]: { 
    color: 'bg-blue-600', 
    label: 'Agua', 
    icon: null,
    image: 'agua.png' 
  },
  [TILE_TYPES.RIFLE]: { 
    color: 'bg-slate-600', 
    label: 'Rifle', 
    icon: <Target size={16} className="text-white" />,
    image: 'rifle.png' 
  },
  [TILE_TYPES.SHOTGUN]: { 
    color: 'bg-slate-700', 
    label: 'Shotgun', 
    icon: <Zap size={16} className="text-white" />,
    image: 'shotgun.png' 
  },
  [TILE_TYPES.KEY]: { 
    color: 'bg-yellow-500', 
    label: 'Llave', 
    icon: null,
    image: 'llave.png' 
  },
  [TILE_TYPES.PORTAL]: { 
    color: 'bg-purple-600', 
    label: 'Portal', 
    icon: null,
    image: 'portal.png' 
  },
  [TILE_TYPES.START]: { 
    color: 'bg-green-600', 
    label: 'Entrada', 
    icon: <Shield size={16} className="text-white" />,
    image: 'entrada.png' 
  },
  [TILE_TYPES.EXIT]: { 
    color: 'bg-red-600', 
    label: 'Salida', 
    icon: <Flag size={16} className="text-white" />,
    image: 'salida.png' 
  },
};

// Personajes disponibles
const CHARACTERS = [
  { id: 'samurai', name: 'Samurái', image: 'samurai.png', speed: 1.0, health: 100 },
  { id: 'ninja', name: 'Ninja', image: 'ninja.png', speed: 1.2, health: 80 },
  { id: 'rambo', name: 'Rambo', image: 'rambo.png', speed: 0.9, health: 120 },
  { id: 'civil', name: 'Civil', image: 'civil.png', speed: 1.1, health: 90 },
  { id: 'terminator', name: 'Terminator', image: 'terminator.png', speed: 0.8, health: 150 }
];

const INITIAL_LEVEL = {
  name: "Nivel 1 - El Comienzo",
  width: 12,
  height: 12,
  timeLimit: 120,
  grid: Array(12 * 12).fill(TILE_TYPES.EMPTY),
};

export default function App() {
  const [appState, setAppState] = useState('loading'); // 'loading', 'menu', 'brain', 'player'
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [levels, setLevels] = useState([INITIAL_LEVEL]);
  const [currentLevelIdx, setCurrentLevelIdx] = useState(0);
  
  // Estado del Editor
  const [editorTool, setEditorTool] = useState(TILE_TYPES.WALL);
  const [editorLevel, setEditorLevel] = useState(null);

  // Estado del Juego
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [gameLevel, setGameLevel] = useState(null);
  const [playerPosition, setPlayerPosition] = useState({ x: 0, y: 0 });
  const [playerInventory, setPlayerInventory] = useState({
    rifle: 0,
    shotgun: 0,
    keys: 0
  });
  const [zombies, setZombies] = useState([]);
  const [lives, setLives] = useState(3);
  const [timeLeft, setTimeLeft] = useState(0);
  const [gameState, setGameState] = useState('ready'); // 'playing', 'won', 'lost'
  const [message, setMessage] = useState("");

  // Simular carga inicial
  useEffect(() => {
    const loadAssets = async () => {
      const interval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 10;
        });
      }, 200);

      setTimeout(() => {
        clearInterval(interval);
        setAppState('menu');
      }, 2500);
    };

    if (appState === 'loading') {
      loadAssets();
    }
  }, [appState]);

  // Inicializar editor al entrar
  const startBrainMode = () => {
    setEditorLevel({...levels[currentLevelIdx]});
    setAppState('brain');
  };

  const startPlayerMode = (idx) => {
    setCurrentLevelIdx(idx);
    setAppState('character-select');
  };

  const startGameWithCharacter = (character) => {
    const level = levels[currentLevelIdx];
    const startIndex = level.grid.findIndex(t => t === TILE_TYPES.START);
    const startPos = startIndex !== -1 ? 
      { x: startIndex % level.width, y: Math.floor(startIndex / level.width) } : 
      { x: 0, y: 0 };
    
    const initialZombies = level.grid
      .map((type, i) => type === TILE_TYPES.ZOMBIE ? { 
        x: i % level.width, 
        y: Math.floor(i / level.width), 
        id: i,
        speed: 0.5 + Math.random() * 0.5
      } : null)
      .filter(z => z !== null);

    setSelectedCharacter(character);
    setGameLevel(level);
    setPlayerPosition(startPos);
    setZombies(initialZombies);
    setLives(Math.floor(character.health / 50));
    setTimeLeft(level.timeLimit);
    setGameState('playing');
    setAppState('player');
    setPlayerInventory({ rifle: 0, shotgun: 0, keys: 0 });
    setMessage(`¡Bienvenido ${character.name}! Encuentra la salida.`);
  };

  // --- LÓGICA DEL EDITOR ---
  const updateEditorGrid = (index) => {
    const newGrid = [...editorLevel.grid];
    
    // Solo permitir una entrada y una salida
    if (editorTool === TILE_TYPES.START) {
      newGrid.forEach((t, i) => { if(t === TILE_TYPES.START) newGrid[i] = TILE_TYPES.EMPTY });
    }
    if (editorTool === TILE_TYPES.EXIT) {
      newGrid.forEach((t, i) => { if(t === TILE_TYPES.EXIT) newGrid[i] = TILE_TYPES.EMPTY });
    }
    
    newGrid[index] = editorTool;
    setEditorLevel({ ...editorLevel, grid: newGrid });
  };

  const saveLevel = () => {
    const newLevels = [...levels];
    newLevels[currentLevelIdx] = editorLevel;
    setLevels(newLevels);
    setAppState('menu');
  };

  const createNewLevel = () => {
    const newList = [...levels, { 
      ...INITIAL_LEVEL, 
      name: `Nivel ${levels.length + 1}`,
      width: 10,
      height: 10,
      grid: Array(10 * 10).fill(TILE_TYPES.EMPTY)
    }];
    setLevels(newList);
    setCurrentLevelIdx(newList.length - 1);
  };

  const deleteLevel = (index) => {
    if (levels.length <= 1) return;
    const newLevels = levels.filter((_, i) => i !== index);
    setLevels(newLevels);
    setCurrentLevelIdx(0);
  };

  // --- LÓGICA DEL JUEGO ---
  const movePlayer = useCallback((dx, dy) => {
    if (gameState !== 'playing') return;

    setPlayerPosition(prev => {
      const nextX = prev.x + dx;
      const nextY = prev.y + dy;
      
      // Limites
      if (nextX < 0 || nextX >= gameLevel.width || nextY < 0 || nextY >= gameLevel.height) return prev;
      
      const nextIdx = nextY * gameLevel.width + nextX;
      const tile = gameLevel.grid[nextIdx];
      
      // Colisiones
      if ([TILE_TYPES.WALL, TILE_TYPES.ROCK, TILE_TYPES.BOX, TILE_TYPES.WATER].includes(tile)) return prev;
      
      // Recolectar items
      if (tile === TILE_TYPES.RIFLE) {
        setPlayerInventory(inv => ({ ...inv, rifle: inv.rifle + 1 }));
        setMessage("¡Has encontrado un Rifle!");
        const newGrid = [...gameLevel.grid];
        newGrid[nextIdx] = TILE_TYPES.EMPTY;
        setGameLevel({...gameLevel, grid: newGrid});
      }
      
      if (tile === TILE_TYPES.SHOTGUN) {
        setPlayerInventory(inv => ({ ...inv, shotgun: inv.shotgun + 1 }));
        setMessage("¡Has encontrado una Shotgun!");
        const newGrid = [...gameLevel.grid];
        newGrid[nextIdx] = TILE_TYPES.EMPTY;
        setGameLevel({...gameLevel, grid: newGrid});
      }
      
      if (tile === TILE_TYPES.KEY) {
        setPlayerInventory(inv => ({ ...inv, keys: inv.keys + 1 }));
        setMessage("¡Has encontrado una Llave!");
        const newGrid = [...gameLevel.grid];
        newGrid[nextIdx] = TILE_TYPES.EMPTY;
        setGameLevel({...gameLevel, grid: newGrid});
      }
      
      // Portal
      if (tile === TILE_TYPES.PORTAL) {
        setMessage("¡Portal activado! Teletransportando...");
        setTimeout(() => {
          // Encontrar posición aleatoria vacía
          let newPos;
          do {
            const rx = Math.floor(Math.random() * gameLevel.width);
            const ry = Math.floor(Math.random() * gameLevel.height);
            const idx = ry * gameLevel.width + rx;
            if (gameLevel.grid[idx] === TILE_TYPES.EMPTY) {
              newPos = { x: rx, y: ry };
            }
          } while (!newPos);
          setPlayerPosition(newPos);
        }, 500);
        return prev;
      }

      // Salida (requiere llave si hay una en el nivel)
      if (tile === TILE_TYPES.EXIT) {
        const hasKeyInLevel = gameLevel.grid.some(t => t === TILE_TYPES.KEY);
        if (hasKeyInLevel && playerInventory.keys === 0) {
          setMessage("¡Necesitas una llave para salir!");
          return prev;
        }
        setGameState('won');
        setMessage("¡Has escapado con éxito!");
        return prev;
      }

      return { x: nextX, y: nextY };
    });
  }, [gameState, gameLevel, playerInventory]);

  // Manejo de teclado
  useEffect(() => {
    const handleKey = (e) => {
      if (appState !== 'player' || gameState !== 'playing') return;
      if (e.key === 'ArrowUp') movePlayer(0, -1);
      if (e.key === 'ArrowDown') movePlayer(0, 1);
      if (e.key === 'ArrowLeft') movePlayer(-1, 0);
      if (e.key === 'ArrowRight') movePlayer(1, 0);
      if (e.key === ' ') { // Espacio para atacar
        if (playerInventory.rifle > 0 || playerInventory.shotgun > 0) {
          attackZombies();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [appState, gameState, movePlayer, playerInventory]);

  const attackZombies = () => {
    // Eliminar zombies cercanos
    setZombies(prev => {
      const newZombies = prev.filter(z => {
        const dist = Math.abs(z.x - playerPosition.x) + Math.abs(z.y - playerPosition.y);
        return dist > 1; // Solo elimina zombies adyacentes
      });
      
      if (newZombies.length < prev.length) {
        setMessage("¡Has eliminado zombies!");
        // Consumir munición
        if (playerInventory.shotgun > 0) {
          setPlayerInventory(inv => ({ ...inv, shotgun: inv.shotgun - 1 }));
        } else if (playerInventory.rifle > 0) {
          setPlayerInventory(inv => ({ ...inv, rifle: inv.rifle - 1 }));
        }
      }
      
      return newZombies;
    });
  };

  // Gameloop: Tiempo y Zombis
  useEffect(() => {
    if (appState !== 'player' || gameState !== 'playing') return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setGameState('lost');
          setMessage("Se agotó el tiempo");
          return 0;
        }
        return prev - 1;
      });

      // Movimiento de Zombis
      setZombies(prevZombies => {
        return prevZombies.map(z => {
          const distX = playerPosition.x - z.x;
          const distY = playerPosition.y - z.y;
          
          let dx = 0, dy = 0;
          
          // Perseguir al jugador
          if (Math.abs(distX) > Math.abs(distY)) {
            dx = distX > 0 ? 1 : -1;
          } else {
            dy = distY > 0 ? 1 : -1;
          }

          const nx = z.x + dx;
          const ny = z.y + dy;
          
          // Verificar colisiones para el zombi
          if (nx >= 0 && nx < gameLevel.width && ny >= 0 && ny < gameLevel.height) {
            const ni = ny * gameLevel.width + nx;
            const t = gameLevel.grid[ni];
            if (![TILE_TYPES.WALL, TILE_TYPES.ROCK, TILE_TYPES.BOX, TILE_TYPES.WATER, TILE_TYPES.EXIT].includes(t)) {
              return { ...z, x: nx, y: ny };
            }
          }
          return z;
        });
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [appState, gameState, playerPosition, gameLevel]);

  // Detección de colisión Zombi -> Jugador
  useEffect(() => {
    if (gameState !== 'playing') return;
    
    const playerIdx = playerPosition.y * gameLevel.width + playerPosition.x;
    const inStart = gameLevel.grid[playerIdx] === TILE_TYPES.START;

    if (!inStart) {
      const collision = zombies.some(z => z.x === playerPosition.x && z.y === playerPosition.y);
      if (collision) {
        setLives(l => {
          if (l <= 1) {
            setGameState('lost');
            setMessage("Los zombies te han devorado");
            return 0;
          }
          setMessage("¡Un zombie te ha atacado!");
          return l - 1;
        });
      }
    }
  }, [zombies, playerPosition, gameState, gameLevel]);

  // --- COMPONENTES DE UI ---

  const LoadingScreen = () => (
    <div className="w-full h-screen bg-slate-900 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Carátula */}
      <div className="relative z-10 text-center">
        <div className="w-64 h-64 mx-auto mb-8 bg-gradient-to-br from-red-900 via-slate-900 to-gray-900 rounded-full 
                      border-4 border-red-600 shadow-2xl flex items-center justify-center animate-pulse">
          <div className="text-center">
            <h1 className="text-5xl font-black text-white mb-2 tracking-tighter">ZOMBIE</h1>
            <h2 className="text-3xl font-bold text-red-500 uppercase">SURVIVOR</h2>
            <p className="text-slate-400 text-sm mt-4">Carga en progreso...</p>
          </div>
        </div>
        
        {/* Barra de carga */}
        <div className="w-80 h-4 bg-slate-800 rounded-full overflow-hidden mx-auto mb-4">
          <div 
            className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 transition-all duration-300"
            style={{ width: `${loadingProgress}%` }}
          />
        </div>
        <div className="text-slate-400 text-sm">
          {loadingProgress}% - Preparando el apocalipsis...
        </div>
      </div>

      {/* Zombies animados de fondo */}
      <div className="absolute inset-0 opacity-10">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="absolute text-4xl animate-bounce"
            style={{
              left: `${20 + i * 15}%`,
              top: `${30 + Math.sin(i) * 40}%`,
              animationDelay: `${i * 0.5}s`
            }}
          >
            💀
          </div>
        ))}
      </div>
    </div>
  );

  const MainMenu = () => (
    <div className="w-full h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-800 flex flex-col items-center justify-center p-6">
      <div className="max-w-2xl w-full text-center">
        <div className="mb-12">
          <h1 className="text-6xl font-black text-white mb-2 tracking-tighter">ZOMBIE SURVIVOR</h1>
          <p className="text-slate-300 text-lg">Construye. Sobrevive. Sobrevive.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
          <div 
            onClick={() => startBrainMode()}
            className="bg-slate-800/70 backdrop-blur-sm border-2 border-blue-500/30 rounded-2xl p-8 cursor-pointer 
                     hover:border-blue-500 hover:scale-105 transition-all duration-300 group"
          >
            <div className="w-20 h-20 bg-blue-900/50 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:bg-blue-700/70">
              <Brain size={40} className="text-blue-300" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Modo Cerebro</h2>
            <p className="text-slate-400 group-hover:text-slate-300">
              Diseña tus propios escenarios de supervivencia con bloques
            </p>
          </div>

          <div 
            onClick={() => startPlayerMode(0)}
            className="bg-slate-800/70 backdrop-blur-sm border-2 border-red-500/30 rounded-2xl p-8 cursor-pointer 
                     hover:border-red-500 hover:scale-105 transition-all duration-300 group"
          >
            <div className="w-20 h-20 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:bg-red-700/70">
              <Swords size={40} className="text-red-300" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Modo Jugador</h2>
            <p className="text-slate-400 group-hover:text-slate-300">
              Sobrevive a los niveles creados. ¡Elige tu personaje!
            </p>
          </div>
        </div>

        <div className="text-slate-500 text-sm">
          <p>El apocalipsis zombie ha comenzado. ¿Estás preparado?</p>
        </div>
      </div>
    </div>
  );

  const CharacterSelect = () => (
    <div className="w-full h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <button 
            onClick={() => setAppState('menu')}
            className="absolute top-4 left-4 text-slate-400 hover:text-white"
          >
            ← Volver
          </button>
          <h1 className="text-4xl font-black text-white mb-2">SELECCIONA TU SUPERVIVIENTE</h1>
          <p className="text-slate-300">Cada personaje tiene habilidades únicas</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          {CHARACTERS.map(char => (
            <div
              key={char.id}
              onClick={() => startGameWithCharacter(char)}
              className="bg-slate-800/70 backdrop-blur-sm border-2 border-slate-700 rounded-xl p-4 cursor-pointer 
                       hover:border-yellow-500 hover:scale-105 transition-all duration-300 group"
            >
              <div className="aspect-square bg-slate-900 rounded-lg mb-4 flex items-center justify-center p-2">
                <div className="text-center">
                  <div className="text-6xl mb-2">🎯</div>
                  <div className="text-sm text-slate-400">{char.name}</div>
                </div>
              </div>
              <h3 className="text-lg font-bold text-white text-center">{char.name}</h3>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Salud:</span>
                  <span className="text-green-400">{char.health}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Velocidad:</span>
                  <span className="text-blue-400">{char.speed.toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vidas:</span>
                  <span className="text-red-400">{Math.floor(char.health / 50)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700">
          <h3 className="text-xl font-bold text-white mb-4">NIVEL A JUGAR</h3>
          <div className="bg-slate-800/70 p-4 rounded-lg">
            <h4 className="font-bold text-white text-lg">{levels[currentLevelIdx]?.name}</h4>
            <p className="text-slate-400">
              Tamaño: {levels[currentLevelIdx]?.width}x{levels[currentLevelIdx]?.height} • 
              Tiempo: {levels[currentLevelIdx]?.timeLimit}s
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const BrainMode = () => (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 to-slate-800 overflow-hidden">
      <div className="p-4 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <Brain className="text-blue-400" size={24} />
          <div>
            <h2 className="font-bold text-white text-lg">MODO CEREBRO - Constructor de Niveles</h2>
            <p className="text-slate-400 text-sm">Diseña tu escenario de supervivencia zombie</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setAppState('menu')}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
          >
            Cancelar
          </button>
          <button 
            onClick={saveLevel} 
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium hover:bg-blue-700"
          >
            <Save size={18} /> Guardar Nivel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col md:flex-row gap-6">
        {/* Editor Sidebar */}
        <div className="w-full md:w-72 space-y-6">
          <div className="bg-slate-800/70 backdrop-blur-sm p-4 rounded-xl border border-slate-700 space-y-4">
            <h3 className="text-sm font-bold text-slate-300 uppercase">Configuración del Nivel</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Nombre del Nivel</label>
                <input 
                  type="text" 
                  value={editorLevel.name} 
                  onChange={(e) => setEditorLevel({...editorLevel, name: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Tamaño (Ancho x Alto)</label>
                <div className="flex gap-2">
                  <input 
                    type="number" 
                    value={editorLevel.width} 
                    onChange={(e) => {
                      const w = Math.max(5, Math.min(20, parseInt(e.target.value) || 5));
                      setEditorLevel({...editorLevel, width: w, grid: Array(w * editorLevel.height).fill(TILE_TYPES.EMPTY)});
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  />
                  <input 
                    type="number" 
                    value={editorLevel.height} 
                    onChange={(e) => {
                      const h = Math.max(5, Math.min(20, parseInt(e.target.value) || 5));
                      setEditorLevel({...editorLevel, height: h, grid: Array(editorLevel.width * h).fill(TILE_TYPES.EMPTY)});
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Tiempo Límite (segundos)</label>
                <input 
                  type="number" 
                  value={editorLevel.timeLimit} 
                  onChange={(e) => setEditorLevel({...editorLevel, timeLimit: parseInt(e.target.value) || 30})}
                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white"
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-800/70 backdrop-blur-sm p-4 rounded-xl border border-slate-700 space-y-3">
            <h3 className="text-sm font-bold text-slate-300 uppercase mb-3">Bloques Disponibles</h3>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(TILE_DATA).map(([type, data]) => (
                <button
                  key={type}
                  onClick={() => setEditorTool(type)}
                  className={`flex flex-col items-center p-3 rounded-lg transition-all ${editorTool === type ? 
                    'bg-blue-900/50 border-2 border-blue-500' : 
                    'bg-slate-900/50 border border-slate-700 hover:border-slate-500'}`}
                >
                  <div className="w-8 h-8 mb-2 flex items-center justify-center">
                    {data.icon ? React.cloneElement(data.icon, { size: 20, className: "text-white" }) : (
                      <div className="w-6 h-6 bg-gradient-to-br from-slate-600 to-slate-800 rounded"></div>
                    )}
                  </div>
                  <span className="text-xs text-slate-300">{data.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 flex flex-col items-center">
          <div className="mb-4 text-center">
            <div className="text-white font-bold mb-1">Herramienta seleccionada:</div>
            <div className="text-blue-400 font-bold">{TILE_DATA[editorTool].label}</div>
          </div>
          <div 
            className="grid gap-1 bg-slate-900/50 backdrop-blur-sm p-4 rounded-xl border border-slate-700"
            style={{ 
              gridTemplateColumns: `repeat(${editorLevel.width}, minmax(0, 1fr))`,
              width: 'fit-content'
            }}
          >
            {editorLevel.grid.map((tile, i) => (
              <div
                key={i}
                onClick={() => updateEditorGrid(i)}
                className={`w-10 h-10 md:w-12 md:h-12 rounded cursor-pointer transition-all 
                          hover:opacity-80 flex items-center justify-center
                          ${tile === TILE_TYPES.EMPTY ? 'bg-slate-800/30 hover:bg-slate-700/50' : TILE_DATA[tile].color}`}
              >
                {TILE_DATA[tile].icon && (
                  <div className="opacity-80">
                    {TILE_DATA[tile].icon}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const PlayerMode = () => {
    const cellSize = Math.min(48, Math.floor(600 / gameLevel.width));
    
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 to-slate-800 overflow-hidden relative">
        {/* HUD Superior */}
        <div className="p-4 flex justify-between items-center bg-slate-800/80 backdrop-blur-sm border-b border-slate-700">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-900 to-red-700 flex items-center justify-center">
                <span className="text-white font-bold">{selectedCharacter?.name.charAt(0)}</span>
              </div>
              <div>
                <div className="text-white font-bold">{selectedCharacter?.name}</div>
                <div className="text-xs text-slate-400">Nivel: {gameLevel.name}</div>
              </div>
            </div>
            
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Heart className="text-red-500 fill-red-500" size={20} />
                <div>
                  <div className="font-black text-xl text-white">{lives}</div>
                  <div className="text-xs text-slate-400">Vidas</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Timer className="text-yellow-400" size={20} />
                <div>
                  <div className="font-mono text-xl text-white">{timeLeft}s</div>
                  <div className="text-xs text-slate-400">Tiempo</div>
                </div>
              </div>
            </div>
          </div>

          {/* Inventario */}
          <div className="flex gap-3">
            {playerInventory.rifle > 0 && (
              <div className="bg-slate-700/50 px-3 py-2 rounded-lg flex items-center gap-2">
                <Target size={16} className="text-blue-400" />
                <span className="text-white font-bold">{playerInventory.rifle}</span>
              </div>
            )}
            {playerInventory.shotgun > 0 && (
              <div className="bg-slate-700/50 px-3 py-2 rounded-lg flex items-center gap-2">
                <Zap size={16} className="text-orange-400" />
                <span className="text-white font-bold">{playerInventory.shotgun}</span>
              </div>
            )}
            {playerInventory.keys > 0 && (
              <div className="bg-slate-700/50 px-3 py-2 rounded-lg flex items-center gap-2">
                <div className="text-yellow-400">🗝️</div>
                <span className="text-white font-bold">{playerInventory.keys}</span>
              </div>
            )}
          </div>
        </div>

        {/* Controles de Ataque */}
        <div className="absolute top-20 right-4 z-20 flex flex-col gap-2">
          {playerInventory.rifle > 0 && (
            <button 
              onClick={attackZombies}
              className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg"
              title="Disparar Rifle (Espacio)"
            >
              <Target size={24} />
            </button>
          )}
          {playerInventory.shotgun > 0 && (
            <button 
              onClick={attackZombies}
              className="bg-orange-600 hover:bg-orange-700 text-white p-3 rounded-full shadow-lg"
              title="Disparar Shotgun (Espacio)"
            >
              <Zap size={24} />
            </button>
          )}
        </div>

        {/* Game Canvas */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
          <div className="relative shadow-2xl rounded-xl overflow-hidden border-2 border-slate-700" 
               style={{ 
                 width: gameLevel.width * cellSize, 
                 height: gameLevel.height * cellSize,
                 background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
               }}>
            
            {/* Grid Rendering */}
            {gameLevel.grid.map((tile, i) => {
              const x = i % gameLevel.width;
              const y = Math.floor(i / gameLevel.width);
              return (
                <div 
                  key={i}
                  className={`absolute transition-all duration-200 ${TILE_DATA[tile].color} 
                            flex items-center justify-center border border-slate-800/30`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    left: x * cellSize,
                    top: y * cellSize,
                  }}
                >
                  {TILE_DATA[tile].icon}
                </div>
              );
            })}

            {/* Zombies Layer */}
            {zombies.map(z => (
              <div 
                key={z.id}
                className="absolute bg-gradient-to-br from-red-800 to-red-900 flex items-center justify-center 
                         transition-all duration-500 ease-out shadow-lg z-10 border-2 border-red-700"
                style={{
                  width: cellSize - 6,
                  height: cellSize - 6,
                  left: z.x * cellSize + 3,
                  top: z.y * cellSize + 3,
                  borderRadius: '4px',
                  animation: 'pulse 2s infinite'
                }}
              >
                <Skull size={cellSize * 0.5} className="text-white opacity-90" />
              </div>
            ))}

            {/* Player Layer */}
            <div 
              className="absolute bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center 
                       transition-all duration-150 ease-out shadow-lg z-20 border-2 border-white"
              style={{
                width: cellSize - 8,
                height: cellSize - 8,
                left: playerPosition.x * cellSize + 4,
                top: playerPosition.y * cellSize + 4,
                borderRadius: '50%',
                boxShadow: '0 0 15px rgba(59, 130, 246, 0.5)'
              }}
            >
              <div className="w-3 h-3 bg-white rounded-full translate-y-[-6px] translate-x-[-6px]"></div>
              <div className="w-3 h-3 bg-white rounded-full translate-y-[-6px] translate-x-[6px]"></div>
            </div>
          </div>
        </div>

        {/* Mobile Controls */}
        <div className="p-6 bg-slate-800/50 backdrop-blur-sm border-t border-slate-700">
          <div className="max-w-xs mx-auto">
            <div className="grid grid-cols-3 gap-3">
              <div />
              <ControlButton onClick={() => movePlayer(0, -1)} icon={<ChevronLeft className="rotate-90" />} />
              <div />
              <ControlButton onClick={() => movePlayer(-1, 0)} icon={<ChevronLeft />} />
              <ControlButton onClick={() => movePlayer(0, 1)} icon={<ChevronLeft className="-rotate-90" />} />
              <ControlButton onClick={() => movePlayer(1, 0)} icon={<ChevronRight />} />
            </div>
          </div>
        </div>

        {/* Feedback Messages */}
        {message && (
          <div className="absolute top-32 left-1/2 -translate-x-1/2 bg-gradient-to-r from-slate-800 to-slate-900 
                        text-white px-6 py-3 rounded-full font-bold shadow-xl animate-bounce z-50 
                        border-2 border-yellow-500 min-w-[200px] text-center">
            {message}
          </div>
        )}

        {/* Overlay Final */}
        {gameState !== 'playing' && (
          <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-sm flex flex-col items-center justify-center z-[100] text-center p-6">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-2 border-slate-700 rounded-2xl p-8 max-w-md">
              <div className={`text-8xl mb-6 ${gameState === 'won' ? 'text-yellow-400' : 'text-red-500'} animate-bounce`}>
                {gameState === 'won' ? '🏆' : '💀'}
              </div>
              <h2 className="text-4xl font-black mb-2 uppercase tracking-tighter text-white">
                {gameState === 'won' ? '¡SOBREVIVISTE!' : '¡HAS MUERTO!'}
              </h2>
              <p className="text-slate-300 mb-6">{message}</p>
              <div className="space-y-3">
                <div className="text-slate-400 text-sm">
                  <p>Personaje: {selectedCharacter?.name}</p>
                  <p>Tiempo restante: {timeLeft}s</p>
                  <p>Vidas restantes: {lives}</p>
                </div>
                <button 
                  onClick={() => setAppState('menu')}
                  className="w-full bg-gradient-to-r from-red-600 to-orange-600 text-white px-8 py-4 
                           rounded-xl font-bold hover:scale-105 transition-transform mt-4"
                >
                  Volver al Menú Principal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const ControlButton = ({ onClick, icon }) => (
    <button 
      onMouseDown={onClick}
      onTouchStart={onClick}
      className="w-16 h-16 bg-gradient-to-b from-slate-700 to-slate-800 rounded-2xl flex items-center 
               justify-center active:bg-gradient-to-b active:from-blue-600 active:to-blue-700 
               active:scale-95 transition-all shadow-lg border-2 border-slate-600"
    >
      <div className="text-white">
        {icon}
      </div>
    </button>
  );

  // Renderizar el estado actual
  switch(appState) {
    case 'loading':
      return <LoadingScreen />;
    case 'menu':
      return <MainMenu />;
    case 'character-select':
      return <CharacterSelect />;
    case 'brain':
      return editorLevel ? <BrainMode /> : <div>Cargando editor...</div>;
    case 'player':
      return gameLevel ? <PlayerMode /> : <div>Cargando juego...</div>;
    default:
      return <LoadingScreen />;
  }
}
