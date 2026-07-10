/**
 * Генератор дорожной сети «центра Москвы»: радиально-кольцевая планировка.
 *
 * Идея: из центра (Кремль) расходятся радиальные проспекты, а поверх них лежат
 * концентрические кольца (Бульварное, Садовое, ТТК и т.д.). Плюс небольшие
 * хорды-срезки, «шум» в координатах перекрёстков и река Москва с мостами.
 */

export interface CityNode {
  id: string;
  x: number;
  y: number;
  /** Номер кольца (0 — центр). Для стилизации/подписей. */
  ring: number;
}

export interface Edge {
  to: string;
  weight: number;
  /** Магистраль (кольцо/крупный проспект) — рисуем толще и ярче. */
  major: boolean;
  /** Мост через реку. */
  bridge: boolean;
}

export interface CityGraph {
  nodes: Map<string, CityNode>;
  graph: Map<string, Edge[]>;
  /** Точки полилинии реки (в мировых координатах) — только для отрисовки. */
  river: { x: number; y: number }[];
  riverWidth: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface CityOptions {
  /** Число концентрических колец (не считая центра). */
  rings?: number;
  /** Число радиальных проспектов (лучей из центра). */
  spokes?: number;
  /** Радиус первого кольца, px. */
  innerRadius?: number;
  /** Прирост радиуса на каждое следующее кольцо, px. */
  ringGap?: number;
  /** Случайное смещение перекрёстков, px. */
  jitter?: number;
  /** Вероятность выкинуть обычное (не магистральное) ребро. */
  dropProbability?: number;
  /** Вероятность добавить диагональную хорду-срезку. */
  chordProbability?: number;
  /** Сид для детерминированной генерации (необязательно). */
  seed?: number;
}

/** Простой детерминированный ГПСЧ (mulberry32), чтобы карту можно было повторить. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMoscowGraph(opts: CityOptions = {}): CityGraph {
  const {
    rings = 8,
    spokes = 14,
    innerRadius = 70,
    ringGap = 62,
    jitter = 14,
    dropProbability = 0.14,
    chordProbability = 0.08,
    seed = Math.floor(Math.random() * 2 ** 31),
  } = opts;

  const rng = makeRng(seed);
  const rand = (min: number, max: number) => min + rng() * (max - min);

  const nodes = new Map<string, CityNode>();
  const graph = new Map<string, Edge[]>();

  const id = (ring: number, spoke: number) => `${ring}:${spoke}`;

  const addNode = (ring: number, spoke: number, x: number, y: number) => {
    const nodeId = id(ring, spoke);
    nodes.set(nodeId, { id: nodeId, x, y, ring });
    graph.set(nodeId, []);
    return nodeId;
  };

  const connect = (aId: string, bId: string, major: boolean, bridge = false) => {
    const a = nodes.get(aId);
    const b = nodes.get(bId);
    if (!a || !b) return;
    if (graph.get(aId)!.some((e) => e.to === bId)) return; // уже соединены
    const weight = Math.hypot(b.x - a.x, b.y - a.y) * (bridge ? 1.15 : 1);
    graph.get(aId)!.push({ to: bId, weight, major, bridge });
    graph.get(bId)!.push({ to: aId, weight, major, bridge });
  };

  // ---- Центр (Кремль/Красная площадь) ----
  addNode(0, 0, 0, 0);

  // ---- Перекрёстки на кольцах ----
  // Радиус кольца слегка растёт нелинейно — ближе к центру плотнее.
  const ringRadius = (r: number) =>
    innerRadius + ringGap * (r - 1) + ringGap * 0.12 * (r - 1) * (r - 1);

  for (let r = 1; r <= rings; r++) {
    const radius = ringRadius(r);
    for (let s = 0; s < spokes; s++) {
      const baseAngle = (s / spokes) * Math.PI * 2;
      // лёгкий «поворот» кольца, чтобы лучи не были идеально прямыми
      const angle = baseAngle + rand(-0.04, 0.04);
      const rr = radius + rand(-jitter, jitter);
      const x = Math.cos(angle) * rr + rand(-jitter, jitter);
      const y = Math.sin(angle) * rr + rand(-jitter, jitter);
      addNode(r, s, x, y);
    }
  }

  // ---- Река: пологая синусоида через центр (аналог излучины Москвы-реки) ----
  const outer = ringRadius(rings);
  const riverWidth = ringGap * 0.85;
  const river: { x: number; y: number }[] = [];
  for (let t = -1.25; t <= 1.25; t += 0.05) {
    const x = t * outer * 1.1;
    const y = Math.sin(t * 2.2) * outer * 0.42 + outer * 0.12;
    river.push({ x, y });
  }
  const distToRiver = (px: number, py: number) => {
    let best = Infinity;
    for (let i = 0; i < river.length - 1; i++) {
      best = Math.min(best, segPointDist(river[i], river[i + 1], px, py));
    }
    return best;
  };
  const crossesRiver = (aId: string, bId: string) => {
    const a = nodes.get(aId)!;
    const b = nodes.get(bId)!;
    // ребро «над водой», если его середина близко к линии реки
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return (
      distToRiver(mx, my) < riverWidth * 0.6 ||
      distToRiver(a.x, a.y) < riverWidth * 0.5 ||
      distToRiver(b.x, b.y) < riverWidth * 0.5
    );
  };

  // Мосты: несколько радиальных направлений, где реку можно пересечь.
  const bridgeSpokes = new Set<number>();
  const bridgeCount = 3 + Math.floor(rng() * 2);
  while (bridgeSpokes.size < bridgeCount) {
    bridgeSpokes.add(Math.floor(rng() * spokes));
  }

  // ---- Радиальные проспекты (центр → кольца) ----
  for (let s = 0; s < spokes; s++) {
    // каждый ~3-й луч делаем «вылетной магистралью» (шире, не рвётся)
    const isAvenue = s % 3 === 0;
    // центр → первое кольцо
    linkRadial(0, 0, 1, s, isAvenue);
    for (let r = 1; r < rings; r++) {
      linkRadial(r, s, r + 1, s, isAvenue);
    }
  }

  function linkRadial(
    r1: number,
    s1: number,
    r2: number,
    s2: number,
    isAvenue: boolean
  ) {
    const aId = id(r1, s1);
    const bId = id(r2, s2);
    const overWater = crossesRiver(aId, bId);
    if (overWater && !bridgeSpokes.has(s2)) return; // радиус упирается в воду без моста
    // изредка «обрываем» обычный радиус (тупик/переулок)
    if (!isAvenue && !overWater && rng() < dropProbability) return;
    connect(aId, bId, isAvenue, overWater);
  }

  // ---- Кольцевые дороги ----
  for (let r = 1; r <= rings; r++) {
    // Садовое, ТТК и внешнее кольцо — сплошные магистрали.
    const isMajorRing = r === 3 || r === 5 || r === rings;
    for (let s = 0; s < spokes; s++) {
      const aId = id(r, s);
      const bId = id(r, (s + 1) % spokes);
      const overWater = crossesRiver(aId, bId);
      // кольца всегда пересекают воду по мосту (иначе граф рвётся)
      if (!isMajorRing && !overWater && rng() < dropProbability * 0.7) continue;
      connect(aId, bId, isMajorRing, overWater);
    }
  }

  // ---- Хорды-срезки (диагонали между соседними кольцами) ----
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < spokes; s++) {
      if (rng() >= chordProbability) continue;
      const aId = id(r, s);
      const bId = id(r + 1, (s + 1) % spokes);
      if (crossesRiver(aId, bId)) continue;
      connect(aId, bId, false);
    }
  }

  // ---- Границы карты ----
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }

  return {
    nodes,
    graph,
    river,
    riverWidth,
    bounds: { minX, minY, maxX, maxY },
  };
}

/** Расстояние от точки до отрезка (a→b). */
function segPointDist(
  a: { x: number; y: number },
  b: { x: number; y: number },
  px: number,
  py: number
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}
