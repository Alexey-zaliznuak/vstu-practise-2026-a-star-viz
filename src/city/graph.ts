/**
 * Параметрический генератор «города в духе Москвы».
 *
 * Что генерируется (все размеры — в метрах, масштаб карты задаётся в километрах):
 *  - радиально-кольцевой каркас магистралей: кольца «кривоватые» (гармонический
 *    шум радиуса), радиусы случайные, радиальные проспекты слегка изогнуты;
 *  - внешняя граничная магистраль по периметру карты (аналог МКАД);
 *  - реки случайной формы от края до края карты (число, извилистость, ширина);
 *  - мосты через реки с примерно постоянным, слегка случайным интервалом;
 *  - ЖД: вокзал и несколько лучей до границ карты + малые станции;
 *  - секции между магистралями со случайным содержимым: жилые кварталы
 *    (сетка улиц + дома), парки (без дорог), озёра, мини-речки, заводы
 *    (большое здание, окружённое дорогой-петлёй с внутренними проездами);
 *  - 0–2 аэропорта на окраине (перрон, полосы, терминал с выездом на магистраль).
 */

export interface Pt {
  x: number;
  y: number;
}

export interface CityNode {
  id: string;
  x: number;
  y: number;
}

export interface Edge {
  to: string;
  weight: number;
  /** Магистраль (кольцо/радиус/граница) — рисуем толще и ярче. */
  major: boolean;
  /** Мост через реку. */
  bridge: boolean;
}

export interface Waterway {
  points: Pt[];
  width: number;
}

export interface Building {
  poly: Pt[];
  color: string;
  /** Слегка скруглённые углы при отрисовке. */
  rounded?: boolean;
}

export interface RoadSegment {
  from: string;
  to: string;
  a: Pt;
  b: Pt;
  weight: number;
  major: boolean;
  bridge: boolean;
}

export interface RailStation {
  x: number;
  y: number;
  main: boolean;
}

export interface Runway {
  a: Pt;
  b: Pt;
  width: number;
}

export interface Airport {
  apron: Pt[];
  runways: Runway[];
  center: Pt;
  terminal: Pt[];
  taxiways: Pt[][];
  tower: Pt;
  parking: Pt[];
}

export interface CityGraph {
  nodes: Map<string, CityNode>;
  graph: Map<string, Edge[]>;
  rivers: Waterway[];
  /** Мини-речки внутри парков (только отрисовка). */
  streams: Waterway[];
  lakes: Pt[][];
  parks: Pt[][];
  buildings: Building[];
  /** Список дорог для попадания кликом и подсказок. */
  roads: RoadSegment[];
  rails: Pt[][];
  stations: RailStation[];
  airports: Airport[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  seed: number;
}

/** Полный набор параметров генератора (см. CITY_DEFAULTS). */
export interface CityParams {
  /** Сторона карты, км. */
  mapSizeKm: number;
  /** Число кольцевых магистралей (не считая границы карты). */
  rings: number;
  /** Число радиальных магистралей. */
  spokes: number;
  /** Кривизна колец и радиусов, 0..1. */
  ringWobble: number;
  /** Размер квартала, м — плотность мелких улиц и застройки. */
  blockSize: number;
  /** Количество рек. */
  rivers: number;
  /** Извилистость рек, 0..1. */
  riverSinuosity: number;
  /** Ширина реки, м. */
  riverWidth: number;
  /** Средний интервал между мостами, м. */
  bridgeInterval: number;
  /** Число ЖД-лучей от вокзала. */
  railLines: number;
  /** Количество аэропортов (0..2). */
  airports: number;
  /** Доля секций-парков, 0..1. */
  parkShare: number;
  /** Доля секций с озером, 0..1. */
  lakeShare: number;
  /** Доля секций-заводов, 0..1. */
  factoryShare: number;
  /** Вероятность обрыва мелкой улицы (тупики). */
  dropProbability: number;
}

export const CITY_DEFAULTS: CityParams = {
  mapSizeKm: 5,
  rings: 5,
  spokes: 12,
  ringWobble: 0.4,
  blockSize: 160,
  rivers: 1,
  riverSinuosity: 0.55,
  riverWidth: 180,
  bridgeInterval: 700,
  railLines: 3,
  airports: 1,
  parkShare: 0.14,
  lakeShare: 0.07,
  factoryShare: 0.12,
  dropProbability: 0.1,
};

export type CityOptions = Partial<CityParams> & { seed?: number };

/** Простой детерминированный ГПСЧ (mulberry32), чтобы карту можно было повторить по сиду. */
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Палитра застройки (взвешенная — как на стилизованных картах Москвы). */
const BUILDING_PALETTE: { color: string; w: number }[] = [
  { color: "#c94f3d", w: 30 }, // красный
  { color: "#e0913f", w: 22 }, // оранжевый
  { color: "#e3c65b", w: 16 }, // жёлтый
  { color: "#4f86c0", w: 14 }, // синий
  { color: "#5da45f", w: 10 }, // зелёный
  { color: "#7e8899", w: 8 }, // серый
];
const PALETTE_TOTAL = BUILDING_PALETTE.reduce((s, p) => s + p.w, 0);

type SectionKind = "residential" | "park" | "lake" | "factory" | "airport";

export function generateCity(opts: CityOptions = {}): CityGraph {
  const o: CityParams = { ...CITY_DEFAULTS, ...opts };
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = makeRng(seed);
  const rand = (min: number, max: number) => min + rng() * (max - min);

  const S = Math.max(1, o.mapSizeKm) * 1000;
  const half = S / 2;
  const beltR = half * 0.96; // граничная магистраль (квадрат)
  const maxR = half * 0.76; // радиус внешнего круглого кольца
  const rings = clamp(Math.round(o.rings), 1, 12);
  const spokes = clamp(Math.round(o.spokes), 4, 24);
  const LV = rings + 1; // уровень граничной магистрали
  const blockSize = Math.max(60, o.blockSize);
  const drop = clamp(o.dropProbability, 0, 0.6);

  // ======================= 1. Каркас: кольца и радиусы =======================

  // Случайные, но упорядоченные радиусы колец с минимальным зазором.
  const minGap = (maxR * 0.4) / rings;
  const radii: number[] = [];
  for (let r = 1; r <= rings; r++) radii.push((maxR * (r - rand(0, 0.8))) / rings);
  radii.sort((a, b) => a - b);
  radii[0] = Math.max(radii[0], Math.min(420, maxR * 0.18));
  for (let i = 1; i < rings; i++) radii[i] = Math.max(radii[i], radii[i - 1] + minGap);
  const over = radii[rings - 1] / maxR;
  if (over > 1) for (let i = 0; i < rings; i++) radii[i] /= over;

  // Общая «форма» города: крупные гармоники, одинаковые для всех колец.
  // Так кольца гнутся синхронно и не пересекаются, а амплитуда не ограничена
  // зазором между кольцами — кривизна заметна даже на огромных картах.
  // Суммарная амплитуда ≤ ~0.24, чтобы внешнее кольцо не вылезло за границу.
  const globalHarmonics: { k: number; amp: number; phase: number }[] = [];
  for (let k = 1; k <= 3; k++) {
    globalHarmonics.push({
      k,
      amp: (o.ringWobble * 0.13 * rand(0.55, 1)) / k,
      phase: rand(0, Math.PI * 2),
    });
  }

  // Индивидуальные гармоники каждого кольца (мелкая рябь; амплитуда ограничена,
  // чтобы соседние кольца не пересекались).
  const harmonics = radii.map((R, idx) => {
    const ampBase = Math.min(o.ringWobble * 0.13, (minGap * 0.45) / R);
    const hs: { k: number; amp: number; phase: number }[] = [];
    for (let k = 1; k <= 3; k++) {
      hs.push({
        k: k + (idx % 2),
        amp: (ampBase * rand(0.25, 1)) / k,
        phase: rand(0, Math.PI * 2),
      });
    }
    return hs;
  });

  /** Радиус «кольца» уровня level в направлении th. Уровень LV — квадратная граница карты. */
  const ringRadius = (level: number, th: number): number => {
    if (level <= 0) return 0;
    if (level >= LV) return beltR / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
    let f = 1;
    for (const g of globalHarmonics) f += g.amp * Math.sin(g.k * th + g.phase);
    for (const h of harmonics[level - 1]) f += h.amp * Math.sin(h.k * th + h.phase);
    return radii[level - 1] * f;
  };

  // Радиальные проспекты: базовый угол + «увод» с ростом радиуса (изогнутость).
  const gapA = (Math.PI * 2) / spokes;
  const baseAngles: number[] = [];
  const drifts: number[] = [];
  for (let s = 0; s < spokes; s++) {
    baseAngles.push(s * gapA + rand(-0.3, 0.3) * gapA);
    drifts.push(rand(-1, 1) * 0.35 * o.ringWobble + rand(-0.1, 0.1));
  }
  const spokeAngle = (s: number, levelF: number): number => {
    const si = s % spokes;
    const wrap = s >= spokes ? Math.PI * 2 : 0;
    return baseAngles[si] + wrap + drifts[si] * (levelF / LV);
  };

  // ======================= 2. Узлы и рёбра =======================

  const nodes = new Map<string, CityNode>();
  const graph = new Map<string, Edge[]>();
  let nodeSeq = 0;

  const addNodeAt = (p: Pt): string => {
    const id = `n${nodeSeq++}`;
    nodes.set(id, { id, x: p.x, y: p.y });
    graph.set(id, []);
    return id;
  };

  const connect = (aId: string, bId: string, major: boolean, bridge = false) => {
    const a = nodes.get(aId);
    const b = nodes.get(bId);
    if (!a || !b || aId === bId) return;
    if (graph.get(aId)!.some((e) => e.to === bId)) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    // Вес = длина в метрах; магистрали чуть «дешевле», мосты — чуть дороже.
    let weight = dist;
    if (major) weight *= 0.88;
    if (bridge) weight *= 1.12;
    graph.get(aId)!.push({ to: bId, weight, major, bridge });
    graph.get(bId)!.push({ to: aId, weight, major, bridge });
  };

  const removeEdge = (aId: string, bId: string) => {
    graph.set(aId, (graph.get(aId) ?? []).filter((e) => e.to !== bId));
    graph.set(bId, (graph.get(bId) ?? []).filter((e) => e.to !== aId));
  };

  const removeNode = (id: string) => {
    for (const e of graph.get(id) ?? []) {
      graph.set(e.to, (graph.get(e.to) ?? []).filter((x) => x.to !== id));
    }
    graph.delete(id);
    nodes.delete(id);
  };

  const polar = (th: number, R: number): Pt => ({ x: Math.cos(th) * R, y: Math.sin(th) * R });

  // Угловые узлы каркаса: corner[level][s]
  const corner: string[][] = [];
  const centerId = addNodeAt({ x: 0, y: 0 });
  corner[0] = new Array<string>(spokes).fill(centerId);
  for (let level = 1; level <= LV; level++) {
    corner[level] = [];
    for (let s = 0; s < spokes; s++) {
      const th = spokeAngle(s, level);
      corner[level][s] = addNodeAt(polar(th, ringRadius(level, th)));
    }
  }

  const segLen = Math.max(90, blockSize * 1.25);
  const jitterPt = (p: Pt, j: number): Pt => ({ x: p.x + rand(-j, j), y: p.y + rand(-j, j) });

  // Кольцевые сегменты: ringSeg[level][s] — узлы вдоль кольца от угла s до s+1 (включительно).
  const ringSeg: string[][][] = [];
  for (let level = 1; level <= LV; level++) {
    ringSeg[level] = [];
    for (let s = 0; s < spokes; s++) {
      const th1 = spokeAngle(s, level);
      const th2 = spokeAngle(s + 1, level);
      const midR = ringRadius(level, (th1 + th2) / 2);
      const n = clamp(Math.round((Math.abs(th2 - th1) * midR) / segLen), 1, 60);
      const ids: string[] = [corner[level][s]];
      for (let i = 1; i < n; i++) {
        const th = lerp(th1, th2, i / n);
        ids.push(addNodeAt(jitterPt(polar(th, ringRadius(level, th)), 8)));
      }
      ids.push(corner[level][(s + 1) % spokes]);
      for (let i = 0; i < ids.length - 1; i++) connect(ids[i], ids[i + 1], true);
      ringSeg[level][s] = ids;
    }
  }

  // Радиальные сегменты: radSeg[level][s] — вдоль проспекта s от уровня level к level+1.
  const radSeg: string[][][] = [];
  for (let level = 0; level <= rings; level++) {
    radSeg[level] = [];
    for (let s = 0; s < spokes; s++) {
      const thA = spokeAngle(s, level);
      const thB = spokeAngle(s, level + 1);
      const pA = polar(thA, ringRadius(level, thA));
      const pB = polar(thB, ringRadius(level + 1, thB));
      const n = clamp(Math.round(Math.hypot(pB.x - pA.x, pB.y - pA.y) / segLen), 1, 60);
      const ids: string[] = [corner[level][s]];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const th = lerp(thA, thB, t);
        const R = lerp(ringRadius(level, th), ringRadius(level + 1, th), t);
        ids.push(addNodeAt(jitterPt(polar(th, R), 8)));
      }
      ids.push(corner[level + 1][s]);
      for (let i = 0; i < ids.length - 1; i++) connect(ids[i], ids[i + 1], true);
      radSeg[level][s] = ids;
    }
  }

  // ======================= 3. Секции и их содержимое =======================

  /**
   * Параметризация секции (level, s): u — вдоль кольца (0..1 между соседними
   * радиусами), v — вдоль радиуса (0 — внутреннее кольцо, 1 — внешнее).
   * Учитывает кривизну колец и увод радиусов.
   */
  const sectionPoint = (level: number, s: number, u: number, v: number): Pt => {
    const thL = spokeAngle(s, level + v);
    const thR = spokeAngle(s + 1, level + v);
    const th = lerp(thL, thR, u);
    const R = lerp(ringRadius(level, th), ringRadius(level + 1, th), v);
    return polar(th, R);
  };

  /** Полигон-«рамка» секции, повторяющий кривизну её границ. */
  const paramRect = (level: number, s: number, u0: number, u1: number, v0: number, v1: number): Pt[] => {
    const pts: Pt[] = [];
    const N = 5;
    for (let k = 0; k < N; k++) pts.push(sectionPoint(level, s, lerp(u0, u1, k / N), v0));
    for (let k = 0; k < N; k++) pts.push(sectionPoint(level, s, u1, lerp(v0, v1, k / N)));
    for (let k = 0; k < N; k++) pts.push(sectionPoint(level, s, lerp(u1, u0, k / N), v1));
    for (let k = 0; k < N; k++) pts.push(sectionPoint(level, s, u0, lerp(v1, v0, k / N)));
    return pts;
  };

  const blob = (level: number, s: number, cu: number, cv: number, ru: number, rv: number): Pt[] => {
    const pts: Pt[] = [];
    const p1 = rand(0, Math.PI * 2);
    const p2 = rand(0, Math.PI * 2);
    const n = 16;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const f = 1 + 0.22 * Math.sin(2 * a + p1) + 0.12 * Math.sin(3 * a + p2);
      pts.push(sectionPoint(level, s, cu + Math.cos(a) * ru * f, cv + Math.sin(a) * rv * f));
    }
    return pts;
  };

  const nearestOf = (ids: string[], p: Pt): string | null => {
    let best: string | null = null;
    let bd = Infinity;
    for (const id of ids) {
      const n = nodes.get(id);
      if (!n) continue;
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };

  const pickColor = (): string => {
    let r = rng() * PALETTE_TOTAL;
    for (const p of BUILDING_PALETTE) {
      r -= p.w;
      if (r <= 0) return p.color;
    }
    return BUILDING_PALETTE[0].color;
  };

  /** Прямоугольник в локальной системе ячейки (углы p00, p10, p01 — доли 0..1). */
  const cellRect = (p00: Pt, uVec: Pt, vVec: Pt, fu0: number, fu1: number, fv0: number, fv1: number): Pt[] => [
    { x: p00.x + uVec.x * fu0 + vVec.x * fv0, y: p00.y + uVec.y * fu0 + vVec.y * fv0 },
    { x: p00.x + uVec.x * fu1 + vVec.x * fv0, y: p00.y + uVec.y * fu1 + vVec.y * fv0 },
    { x: p00.x + uVec.x * fu1 + vVec.x * fv1, y: p00.y + uVec.y * fu1 + vVec.y * fv1 },
    { x: p00.x + uVec.x * fu0 + vVec.x * fv1, y: p00.y + uVec.y * fu0 + vVec.y * fv1 },
  ];

  /**
   * Квартал с двором: вдоль улиц — вытянутые продольные корпуса (как на референсе).
   * Размеры в метрах, ориентация — вдоль границ ячейки, а не к центру города.
   */
  const fillCourtyardBlock = (
    level: number,
    s: number,
    u0: number,
    u1: number,
    v0: number,
    v1: number
  ) => {
    const p00 = sectionPoint(level, s, u0, v0);
    const p10 = sectionPoint(level, s, u1, v0);
    const p01 = sectionPoint(level, s, u0, v1);
    const uVec = { x: p10.x - p00.x, y: p10.y - p00.y };
    const vVec = { x: p01.x - p00.x, y: p01.y - p00.y };
    const wM = Math.hypot(uVec.x, uVec.y);
    const hM = Math.hypot(vVec.x, vVec.y);
    if (wM < 28 || hM < 28) return;
    if (rng() < 0.09) return;

    const street = clamp(rand(8, 14), 6, Math.min(wM, hM) * 0.14);
    const depth = clamp(rand(10, 17), 8, Math.min(wM, hM) * 0.32);
    const sf = street / wM;
    const stf = street / hM;
    const df = depth / hM;
    const dfu = depth / wM;

    const addSide = (
      alongU: boolean,
      stripCount: number,
      fu0: number,
      fu1: number,
      fv0: number,
      fv1: number
    ) => {
      if (rng() < 0.07) return;
      const gap = rand(0.006, 0.014);
      for (let k = 0; k < stripCount; k++) {
        const t0 = k / stripCount;
        const t1 = (k + 1) / stripCount;
        let poly: Pt[];
        if (alongU) {
          poly = cellRect(
            p00,
            uVec,
            vVec,
            fu0 + (fu1 - fu0) * t0 + gap,
            fu0 + (fu1 - fu0) * t1 - gap,
            fv0,
            fv1
          );
        } else {
          poly = cellRect(
            p00,
            uVec,
            vVec,
            fu0,
            fu1,
            fv0 + (fv1 - fv0) * t0 + gap,
            fv0 + (fv1 - fv0) * t1 - gap
          );
        }
        buildings.push({
          poly,
          color: pickColor(),
          rounded: rng() < 0.14,
        });
      }
    };

    const innerU0 = sf;
    const innerU1 = 1 - sf;
    const innerV0 = stf;
    const innerV1 = 1 - stf;

    // Нижняя и верхняя улицы — длинные продольные корпуса (большинство).
    const nAlongU = clamp(Math.round(wM / rand(20, 34)), 2, 7);
    addSide(true, nAlongU, innerU0, innerU1, innerV0, innerV0 + df);
    addSide(true, nAlongU, innerU0, innerU1, innerV1 - df, innerV1);

    // Боковые — короче, 1–3 корпуса.
    const nAlongV = clamp(Math.round(hM / rand(28, 48)), 1, 3);
    addSide(false, nAlongV, innerU0, innerU0 + dfu, innerV0, innerV1);
    addSide(false, nAlongV, innerU1 - dfu, innerU1, innerV0, innerV1);
  };

  const parks: Pt[][] = [];
  const lakes: Pt[][] = [];
  const streams: Waterway[] = [];
  const buildings: Building[] = [];
  const airports: Airport[] = [];

  // Дома фиксированного размера (~квартал 120 м). На гигантских картах их
  // влезли бы миллионы — прореживаем застройку под общий бюджет, иначе
  // генерация и рендер захлёбываются.
  const COURTYARD_PITCH = 118;
  const COURTYARD_BUDGET = 3500;
  const estCourtyards = (S * S * 0.45) / (COURTYARD_PITCH * COURTYARD_PITCH);
  const courtyardDensity = Math.min(1, COURTYARD_BUDGET / estCourtyards);

  // Аэропорты занимают целые секции на окраине (внешний пояс), подальше друг от друга.
  const airportWanted = clamp(Math.round(o.airports), 0, 2);
  const airportAt = new Set<string>();
  if (airportWanted > 0) {
    const s0 = Math.floor(rng() * spokes);
    airportAt.add(`${rings}:${s0}`);
    if (airportWanted > 1) airportAt.add(`${rings}:${(s0 + Math.floor(spokes / 2)) % spokes}`);
  }

  for (let level = 0; level <= rings; level++) {
    for (let s = 0; s < spokes; s++) {
      const pA = sectionPoint(level, s, 0, 0.5);
      const pB = sectionPoint(level, s, 1, 0.5);
      const width = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const pC = sectionPoint(level, s, 0.5, 0);
      const pD = sectionPoint(level, s, 0.5, 1);
      const height = Math.hypot(pD.x - pC.x, pD.y - pC.y);

      let kind: SectionKind;
      if (airportAt.has(`${level}:${s}`)) {
        kind = "airport";
      } else if (level === 0 || width < blockSize * 1.6 || height < blockSize * 1.6) {
        kind = "residential"; // центр и слишком мелкие секции — просто застройка
      } else {
        const roll = rng();
        if (roll < o.parkShare) kind = "park";
        else if (roll < o.parkShare + o.lakeShare) kind = "lake";
        else if (roll < o.parkShare + o.lakeShare + o.factoryShare) kind = "factory";
        else kind = "residential";
      }

      const innerB = level >= 1 ? ringSeg[level][s] : [centerId];
      const outerB = ringSeg[level + 1][s];
      const leftB = radSeg[level][s];
      const rightB = radSeg[level][(s + 1) % spokes];

      if (kind === "airport") {
        // Аэропорт не растягивается на всю секцию: на больших картах занимает
        // ограниченную площадку ~3–4.5 км.
        const aSideU = Math.min(0.88, rand(3000, 4500) / Math.max(1, width));
        const aSideV = Math.min(0.88, rand(3000, 4500) / Math.max(1, height));
        const au0 = 0.06 + rand(0, 0.88 - aSideU);
        const av0 = 0.06 + rand(0, 0.88 - aSideV);
        const ax = (f: number) => au0 + aSideU * f;
        const ay = (f: number) => av0 + aSideV * f;
        const apt = (u: number, v: number) => sectionPoint(level, s, ax(u), ay(v));

        const apron = paramRect(level, s, ax(0), ax(1), ay(0), ay(1));
        const rw1a = apt(0.02, 0.34);
        const rw1b = apt(0.98, 0.41);
        const rw2a = apt(0.05, 0.59);
        const rw2b = apt(0.95, 0.66);
        const runways: Runway[] = [
          { a: rw1a, b: rw1b, width: 48 },
          { a: rw2a, b: rw2b, width: 40 },
        ];
        const t00 = apt(0.36, 0.02);
        const t10 = apt(0.7, 0.02);
        const t01 = apt(0.36, 0.18);
        const tU = { x: t10.x - t00.x, y: t10.y - t00.y };
        const tV = { x: t01.x - t00.x, y: t01.y - t00.y };
        const terminal = cellRect(t00, tU, tV, 0, 1, 0, 1);
        const p00 = apt(0.05, 0.02);
        const p10 = apt(0.32, 0.02);
        const p01 = apt(0.05, 0.16);
        const pU = { x: p10.x - p00.x, y: p10.y - p00.y };
        const pV = { x: p01.x - p00.x, y: p01.y - p00.y };
        const parking = cellRect(p00, pU, pV, 0, 1, 0, 1);
        const taxiways: Pt[][] = [
          [apt(0.52, 0.16), apt(0.47, 0.32), rw1a],
          [apt(0.55, 0.16), apt(0.53, 0.57), rw2a],
        ];
        const tower = apt(0.76, 0.12);
        const termId = addNodeAt(apt(0.53, 0.06));
        const pT = nodes.get(termId)!;
        const b1 = nearestOf(innerB, pT);
        const b2 = nearestOf(leftB, pT);
        if (b1) connect(termId, b1, true);
        if (b2) connect(termId, b2, true);
        airports.push({
          apron,
          runways,
          center: apt(0.5, 0.5),
          terminal,
          taxiways,
          tower,
          parking,
        });
        continue;
      }

      // ---- Уличная сетка секции (общая для жилья/парков/заводов) ----
      const nu = clamp(Math.round(width / blockSize), 1, 9);
      const nv = clamp(Math.round(height / blockSize), 1, 9);
      const cellW = width / nu;
      const cellH = height / nv;

      // Спец-зона (парк/озеро/завод), ограниченная по площади в МЕТРАХ:
      // парк/озеро ≤ ~2 км², завод ≤ ~0.6×0.6 км. Зона привязывается к сетке
      // ячеек, но если ячейки огромные (окраины большой карты) — ужимается
      // до целевого размера. Остальное место секции застраивается жильём.
      let zoneRect: { u0: number; u1: number; v0: number; v1: number } | null = null;
      if (kind === "park" || kind === "lake" || kind === "factory") {
        const targetSide = kind === "factory" ? rand(280, 620) : Math.sqrt(rand(0.6, 1.8)) * 1000;
        const spanI = clamp(Math.round(targetSide / cellW), 1, nu);
        const spanJ = clamp(Math.round(targetSide / cellH), 1, nv);
        const i0 = Math.min(nu - spanI, Math.floor(rand(0, nu - spanI + 1)));
        const j0 = Math.min(nv - spanJ, Math.floor(rand(0, nv - spanJ + 1)));
        let u0 = i0 / nu;
        let u1 = (i0 + spanI) / nu;
        let v0 = j0 / nv;
        let v1 = (j0 + spanJ) / nv;
        if ((u1 - u0) * width > targetSide * 1.2) {
          const span = (targetSide * 1.2) / width;
          u0 += rand(0, u1 - u0 - span);
          u1 = u0 + span;
        }
        if ((v1 - v0) * height > targetSide * 1.2) {
          const span = (targetSide * 1.2) / height;
          v0 += rand(0, v1 - v0 - span);
          v1 = v0 + span;
        }
        zoneRect = { u0, u1, v0, v1 };
      }
      const nodeInZone = (i: number, j: number) => {
        if (!zoneRect) return false;
        const u = i / nu;
        const v = j / nv;
        const eps = 0.02;
        return (
          u > zoneRect.u0 + eps && u < zoneRect.u1 - eps && v > zoneRect.v0 + eps && v < zoneRect.v1 - eps
        );
      };

      const inner = new Map<string, string>();
      for (let i = 1; i < nu; i++) {
        for (let j = 1; j < nv; j++) {
          if (nodeInZone(i, j)) continue; // внутри парка/завода обычных улиц нет
          const u = i / nu + rand(-0.15, 0.15) / nu;
          const v = j / nv + rand(-0.15, 0.15) / nv;
          inner.set(`${i}:${j}`, addNodeAt(sectionPoint(level, s, u, v)));
        }
      }
      // улицы-сетка (со случайными обрывами)
      for (let i = 1; i < nu; i++) {
        for (let j = 1; j < nv; j++) {
          const a = inner.get(`${i}:${j}`);
          if (!a) continue;
          const right = inner.get(`${i + 1}:${j}`);
          const down = inner.get(`${i}:${j + 1}`);
          if (right && rng() >= drop) connect(a, right, false);
          if (down && rng() >= drop) connect(a, down, false);
        }
      }
      // привязка сетки к граничным магистралям
      const attach = (nodeId: string | undefined, boundary: string[]) => {
        if (!nodeId || rng() < drop * 0.5) return;
        const n = nodes.get(nodeId)!;
        const b = nearestOf(boundary, n);
        if (b) connect(nodeId, b, false);
      };
      for (let i = 1; i < nu; i++) {
        if (level >= 1) attach(inner.get(`${i}:1`), innerB);
        attach(inner.get(`${i}:${nv - 1}`), outerB);
      }
      for (let j = 1; j < nv; j++) {
        attach(inner.get(`1:${j}`), leftB);
        attach(inner.get(`${nu - 1}:${j}`), rightB);
      }

      // ---- Содержимое спец-зоны ----
      if (zoneRect) {
        const zu0 = zoneRect.u0;
        const zu1 = zoneRect.u1;
        const zv0 = zoneRect.v0;
        const zv1 = zoneRect.v1;
        const zsu = zu1 - zu0;
        const zsv = zv1 - zv0;
        const zcu = (zu0 + zu1) / 2;
        const zcv = (zv0 + zv1) / 2;
        const insU = Math.min(0.16 / nu, zsu * 0.12);
        const insV = Math.min(0.16 / nv, zsv * 0.12);

        if (kind === "park" || kind === "lake") {
          parks.push(paramRect(level, s, zu0 + insU, zu1 - insU, zv0 + insV, zv1 - insV));
          if (kind === "lake") {
            lakes.push(blob(level, s, zcu, zcv, zsu * 0.32, zsv * 0.32));
          } else {
            if (rng() < 0.45) {
              lakes.push(
                blob(
                  level,
                  s,
                  zcu + rand(-0.18, 0.18) * zsu,
                  zcv + rand(-0.15, 0.15) * zsv,
                  zsu * rand(0.1, 0.16),
                  zsv * rand(0.1, 0.16)
                )
              );
            }
            if (rng() < 0.55) {
              // мини-речка через парк
              const pts: Pt[] = [];
              const w0 = rand(0.15, 0.85);
              const w1 = rand(0.15, 0.85);
              const ph = rand(0, Math.PI * 2);
              for (let k = 0; k <= 10; k++) {
                const t = k / 10;
                const w = clamp(w0 + (w1 - w0) * t + 0.07 * Math.sin(t * 5 + ph), 0.06, 0.94);
                pts.push(sectionPoint(level, s, zu0 + zsu * (0.06 + t * 0.88), zv0 + zsv * w));
              }
              streams.push({ points: pts, width: rand(10, 22) });
            }
          }
        } else if (kind === "factory") {
          // Дорога-петля по периметру заводской зоны.
          const fu0 = zu0 + zsu * 0.14;
          const fu1 = zu1 - zsu * 0.14;
          const fv0 = zv0 + zsv * 0.14;
          const fv1 = zv1 - zsv * 0.14;
          const loopUV: [number, number][] = [];
          for (let i = 0; i < 3; i++) loopUV.push([lerp(fu0, fu1, i / 3), fv0]);
          for (let i = 0; i < 3; i++) loopUV.push([fu1, lerp(fv0, fv1, i / 3)]);
          for (let i = 0; i < 3; i++) loopUV.push([lerp(fu1, fu0, i / 3), fv1]);
          for (let i = 0; i < 3; i++) loopUV.push([fu0, lerp(fv1, fv0, i / 3)]);
          const loopIds = loopUV.map(([u, v]) => addNodeAt(sectionPoint(level, s, u, v)));
          for (let i = 0; i < loopIds.length; i++) {
            connect(loopIds[i], loopIds[(i + 1) % loopIds.length], true);
          }

          // Въезды: 2–3 стороны петли к ближайшим уличным/граничным узлам.
          const targets = [...innerB, ...outerB, ...leftB, ...rightB, ...inner.values()];
          const gateUV: [number, number][] = [
            [(fu0 + fu1) / 2, fv0],
            [(fu0 + fu1) / 2, fv1],
            [fu0, (fv0 + fv1) / 2],
            [fu1, (fv0 + fv1) / 2],
          ];
          for (let i = gateUV.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [gateUV[i], gateUV[j]] = [gateUV[j], gateUV[i]];
          }
          const takeN = 2 + (rng() < 0.4 ? 1 : 0);
          for (const [gu, gv] of gateUV.slice(0, takeN)) {
            const pTarget = sectionPoint(level, s, gu, gv);
            const loopNear = nearestOf(loopIds, pTarget);
            const bnd = nearestOf(targets, pTarget);
            if (loopNear && bnd) connect(loopNear, bnd, false);
          }

          // Внутренние тупиковые проезды.
          const stubs: [number, number, number, number][] = [
            [(fu0 + fu1) / 2, fv0, (fu0 + fu1) / 2, zv0 + zsv * 0.34],
            [fu0, (fv0 + fv1) / 2, zu0 + zsu * 0.34, (fv0 + fv1) / 2],
          ];
          for (const [su, sv, tu, tv] of stubs) {
            if (rng() < 0.3) continue;
            const loopNear = nearestOf(loopIds, sectionPoint(level, s, su, sv));
            if (!loopNear) continue;
            const stubId = addNodeAt(sectionPoint(level, s, tu, tv));
            connect(loopNear, stubId, false);
          }

          // Корпуса завода — в локальной системе зоны (размер зоны уже ограничен).
          const f00 = sectionPoint(level, s, zu0 + zsu * 0.2, zv0 + zsv * 0.22);
          const f10 = sectionPoint(level, s, zu0 + zsu * 0.62, zv0 + zsv * 0.22);
          const f01 = sectionPoint(level, s, zu0 + zsu * 0.2, zv0 + zsv * 0.72);
          const fU = { x: f10.x - f00.x, y: f10.y - f00.y };
          const fV = { x: f01.x - f00.x, y: f01.y - f00.y };
          buildings.push({ poly: cellRect(f00, fU, fV, 0.05, 0.88, 0.08, 0.92), color: "#8a5f52" });
          buildings.push({ poly: cellRect(f00, fU, fV, 0.62, 0.92, 0.1, 0.55), color: "#77685e" });
        }
      }

      // ---- Кварталы с домами по ячейкам (слоты внутри спец-зоны пропускаются) ----
      // Отступ от улиц: узлы сетки джиттерятся на ±15% ячейки, берём чуть больше.
      const padF = 0.17;
      const slotFree = (su0: number, su1: number, sv0: number, sv1: number) =>
        !zoneRect || su1 <= zoneRect.u0 || su0 >= zoneRect.u1 || sv1 <= zoneRect.v0 || sv0 >= zoneRect.v1;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          if (level === 0 && j === 0) continue; // вырожденные ячейки у вершины сектора
          const u0 = (i + padF) / nu;
          const u1 = (i + 1 - padF) / nu;
          const v0 = (j + padF) / nv;
          const v1 = (j + 1 - padF) / nv;
          const wIn = cellW * (1 - 2 * padF);
          const hIn = cellH * (1 - 2 * padF);
          // Кварталы фиксированного шага, слоты прореживаются под бюджет.
          const cu = Math.max(1, Math.round(wIn / COURTYARD_PITCH));
          const cv = Math.max(1, Math.round(hIn / COURTYARD_PITCH));
          const slots = cu * cv;
          const expected = slots * courtyardDensity;
          const count = Math.min(slots, Math.floor(expected) + (rng() < expected % 1 ? 1 : 0));

          const drawSlot = (ci: number, cj: number) => {
            const su0 = u0 + ((u1 - u0) * ci) / cu;
            const su1 = u0 + ((u1 - u0) * (ci + 1)) / cu;
            const sv0 = v0 + ((v1 - v0) * cj) / cv;
            const sv1 = v0 + ((v1 - v0) * (cj + 1)) / cv;
            if (!slotFree(su0, su1, sv0, sv1)) return;
            fillCourtyardBlock(level, s, su0, su1, sv0, sv1);
          };

          if (count >= slots) {
            for (let ci = 0; ci < cu; ci++) for (let cj = 0; cj < cv; cj++) drawSlot(ci, cj);
          } else {
            for (let k = 0; k < count; k++) {
              drawSlot(Math.floor(rng() * cu), Math.floor(rng() * cv));
            }
          }
        }
      }
    }
  }

  // ======================= 4. Реки =======================

  const riversArr: Waterway[] = [];
  const riverCount = clamp(Math.round(o.rivers), 0, 4);
  for (let k = 0; k < riverCount; k++) {
    const a = rand(0, Math.PI) + (k * Math.PI) / Math.max(1, riverCount);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const nrm = { x: -dir.y, y: dir.x };
    const c0 = rand(-0.25, 0.25) * S;
    const L = S * 1.9;
    const waves = [
      { amp: o.riverSinuosity * S * rand(0.06, 0.11), k: rand(1.2, 2.2), ph: rand(0, Math.PI * 2) },
      { amp: o.riverSinuosity * S * rand(0.02, 0.05), k: rand(3, 5), ph: rand(0, Math.PI * 2) },
      { amp: o.riverSinuosity * S * rand(0.008, 0.02), k: rand(7, 11), ph: rand(0, Math.PI * 2) },
    ];
    const pts: Pt[] = [];
    const m = 72;
    for (let i = 0; i <= m; i++) {
      const t = (i / m - 0.5) * L;
      let off = c0;
      for (const w of waves) off += w.amp * Math.sin((w.k * Math.PI * 2 * t) / L + w.ph);
      pts.push({ x: dir.x * t + nrm.x * off, y: dir.y * t + nrm.y * off });
    }
    const clipped = clipPolylineToRect(pts, half);
    if (clipped.length >= 2) {
      riversArr.push({ points: clipped, width: o.riverWidth * rand(0.85, 1.25) });
    }
  }

  // Узлы, попавшие в воду, удаляем (дороги обрываются на берегах).
  for (const [id, n] of [...nodes]) {
    for (const rv of riversArr) {
      if (distToPolyline(rv.points, n.x, n.y) < rv.width / 2 + 6) {
        removeNode(id);
        break;
      }
    }
  }

  // ======================= 5. Мосты =======================

  for (const rv of riversArr) {
    // 1. Убираем все рёбра, пересекающие осевую линию реки или идущие по воде
    //    (узлы в воде уже удалены, но длинные рёбра могли «перепрыгнуть» реку).
    for (const [from, list] of graph) {
      const A = nodes.get(from);
      if (!A) continue;
      for (const edge of [...list]) {
        if (from >= edge.to) continue;
        const B = nodes.get(edge.to);
        if (!B) continue;
        let crosses = false;
        for (let i = 0; i < rv.points.length - 1 && !crosses; i++) {
          crosses = segIntersectT(A, B, rv.points[i], rv.points[i + 1]) !== null;
        }
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        if (crosses || distToPolyline(rv.points, mx, my) < rv.width / 2 - 4) {
          removeEdge(from, edge.to);
        }
      }
    }

    // 2. Мосты: идём вдоль реки с примерно постоянным (слегка случайным)
    //    шагом и в каждой точке соединяем ближайшие сухие узлы двух берегов.
    const cum: number[] = [0];
    for (let i = 1; i < rv.points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(rv.points[i].x - rv.points[i - 1].x, rv.points[i].y - rv.points[i - 1].y));
    }
    const riverLen = cum[cum.length - 1];
    const pointAt = (t: number): { p: Pt; dir: Pt } => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < t) i++;
      const a = rv.points[i - 1];
      const b = rv.points[i];
      const span = cum[i] - cum[i - 1] || 1;
      const u = clamp((t - cum[i - 1]) / span, 0, 1);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        p: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) },
        dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
      };
    };

    const maxSpan = rv.width / 2 + Math.max(rv.width, o.bridgeInterval * 0.45);
    let t = o.bridgeInterval * rand(0.25, 0.75);
    while (t < riverLen) {
      const { p, dir } = pointAt(t);
      // ближайший сухой узел с каждой стороны реки (знак векторного произведения)
      let left: string | null = null;
      let right: string | null = null;
      let dl = Infinity;
      let dr = Infinity;
      for (const n of nodes.values()) {
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > maxSpan) continue;
        const side = dir.x * dy - dir.y * dx;
        if (side > 0 && d < dl) ((dl = d), (left = n.id));
        else if (side < 0 && d < dr) ((dr = d), (right = n.id));
      }
      if (left && right) connect(left, right, true, true);
      t += o.bridgeInterval * rand(0.8, 1.35);
    }
  }

  // Дома, попавшие в воду, убираем.
  const dryBuildings = buildings.filter(
    (b) => !riversArr.some((rv) => b.poly.some((p) => distToPolyline(rv.points, p.x, p.y) < rv.width / 2 + 5))
  );

  // ======================= 6. Железная дорога =======================

  const rails: Pt[][] = [];
  const stations: RailStation[] = [];
  const railLines = clamp(Math.round(o.railLines), 0, 8);
  if (railLines > 0) {
    // Вокзал — на существующем (не смытом рекой) узле среднего кольца.
    let stNode: CityNode | null = null;
    outer: for (const lvlTry of [Math.max(1, Math.round(rings * 0.4)), 1, Math.min(rings, 2)]) {
      const s0 = Math.floor(rng() * spokes);
      for (let ds = 0; ds < spokes; ds++) {
        const n = nodes.get(corner[lvlTry][(s0 + ds) % spokes]);
        if (n) {
          stNode = n;
          break outer;
        }
      }
    }
    if (stNode) {
      stations.push({ x: stNode.x, y: stNode.y, main: true });
      dryBuildings.push({
        poly: [
          { x: stNode.x - 95, y: stNode.y + 24 },
          { x: stNode.x + 95, y: stNode.y + 24 },
          { x: stNode.x + 95, y: stNode.y + 86 },
          { x: stNode.x - 95, y: stNode.y + 86 },
        ],
        color: "#c8a26a",
      });

      const a0 = rand(0, Math.PI * 2);
      for (let i = 0; i < railLines; i++) {
        const ang = a0 + (i * Math.PI * 2) / railLines + rand(-0.2, 0.2);
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const nrm = { x: -dir.y, y: dir.x };
        const pts: Pt[] = [{ x: stNode.x, y: stNode.y }];
        let w = 0;
        for (let t = 350; t < S * 1.6; t += 350) {
          w += rand(-45, 45);
          const p = { x: stNode.x + dir.x * t + nrm.x * w, y: stNode.y + dir.y * t + nrm.y * w };
          if (Math.abs(p.x) > half || Math.abs(p.y) > half) {
            pts.push(borderClip(pts[pts.length - 1], p, half));
            break;
          }
          pts.push(p);
        }
        if (pts.length >= 2) {
          rails.push(pts);
          // малая станция ближе к окраине
          if (pts.length > 4 && rng() < 0.8) {
            const p = pts[Math.floor(pts.length * rand(0.45, 0.75))];
            const inWater = riversArr.some((rv) => distToPolyline(rv.points, p.x, p.y) < rv.width / 2 + 15);
            if (!inWater) stations.push({ x: p.x, y: p.y, main: false });
          }
        }
      }
    }
  }

  // ======================= 7. Чистка =======================

  // Оставляем только крупнейшую компоненту связности — иначе после «смыва»
  // узлов рекой остаются островки, до которых нельзя доехать.
  const visited = new Set<string>();
  let largest: string[] = [];
  for (const start of graph.keys()) {
    if (visited.has(start)) continue;
    const comp: string[] = [start];
    visited.add(start);
    for (let head = 0; head < comp.length; head++) {
      for (const e of graph.get(comp[head]) ?? []) {
        if (!visited.has(e.to)) {
          visited.add(e.to);
          comp.push(e.to);
        }
      }
    }
    if (comp.length > largest.length) largest = comp;
  }
  const keep = new Set(largest);
  for (const id of [...graph.keys()]) {
    if (!keep.has(id)) {
      graph.delete(id);
      nodes.delete(id);
    }
  }

  const roads: RoadSegment[] = [];
  for (const [from, list] of graph) {
    const a = nodes.get(from)!;
    for (const edge of list) {
      if (from >= edge.to) continue;
      const b = nodes.get(edge.to)!;
      roads.push({
        from,
        to: edge.to,
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        weight: edge.weight,
        major: edge.major,
        bridge: edge.bridge,
      });
    }
  }

  return {
    nodes,
    graph,
    rivers: riversArr,
    streams,
    lakes,
    parks,
    buildings: dryBuildings,
    roads,
    rails,
    stations,
    airports,
    bounds: { minX: -half, minY: -half, maxX: half, maxY: half },
    seed,
  };
}

// ======================= Геометрические помощники =======================

/** Расстояние от точки до отрезка (a→b). */
function segPointDist(a: Pt, b: Pt, px: number, py: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function distToPolyline(pts: Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, segPointDist(pts[i], pts[i + 1], x, y));
  }
  return best;
}

/**
 * Пересечение отрезков a→b и c→d.
 * Возвращает параметр вдоль c→d (0..1) или null, если пересечения нет.
 */
function segIntersectT(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return u;
}

/** Точка на границе квадрата [-half, half]² между внутренней inP и внешней outP. */
function borderClip(inP: Pt, outP: Pt, half: number): Pt {
  let a = inP;
  let b = outP;
  for (let i = 0; i < 20; i++) {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (Math.abs(m.x) <= half && Math.abs(m.y) <= half) a = m;
    else b = m;
  }
  return a;
}

/** Самый длинный непрерывный кусок полилинии внутри квадрата [-half, half]². */
function clipPolylineToRect(pts: Pt[], half: number): Pt[] {
  const inside = (p: Pt) => Math.abs(p.x) <= half && Math.abs(p.y) <= half;
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (inside(p)) {
      if (cur.length === 0 && i > 0) cur.push(borderClip(p, pts[i - 1], half));
      cur.push(p);
    } else if (cur.length > 0) {
      cur.push(borderClip(pts[i - 1], p, half));
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  runs.sort((r1, r2) => r2.length - r1.length);
  return runs[0] ?? [];
}
