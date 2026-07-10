import {
  generateMoscowGraph,
  type CityGraph,
  type CityNode,
  type CityOptions,
} from "./graph";
import { AStarRunner, astar } from "./astar";

export interface CityStats {
  nodes: number;
  edges: number;
  scalePercent: number;
  hoverId: string | null;
}

export interface CitySearchState {
  running: boolean;
  finished: boolean;
  found: boolean;
  open: number;
  closed: number;
  pathNodes: number;
  pathCost: number;
}

export interface CitySelection {
  start: string | null;
  goal: string | null;
  /** Что поставится следующим кликом. */
  next: "start" | "goal";
}

const COLORS = {
  bg: "#0d0f14",
  water: "#274a68",
  waterEdge: "#16293a",
  roadNormal: "rgba(150, 162, 186, 0.28)",
  roadMajor: "rgba(232, 196, 120, 0.85)",
  bridge: "rgba(226, 150, 104, 0.9)",
  node: "rgba(150, 162, 186, 0.35)",
  open: "#26c6da",
  closed: "#b06bd6",
  pathEdge: "#ffd600",
  pathNode: "#ffe873",
  start: "#38c172",
  goal: "#f0524b",
  hover: "#ffffff",
  current: "#ff9800",
};

const SEARCH_TREE_EDGE = "rgba(176, 107, 214, 0.5)";

export class CityMap {
  private ctx: CanvasRenderingContext2D;
  private dpr = window.devicePixelRatio || 1;

  private data!: CityGraph;
  private options: CityOptions;

  // Вьюпорт: мир → экран = world * scale + offset
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private readonly minScale = 0.15;
  private readonly maxScale = 6;

  // Выбор точек
  private startId: string | null = null;
  private goalId: string | null = null;
  private hoverId: string | null = null;

  // Панорамирование
  private isPanning = false;
  private lastPointer = { x: 0, y: 0 };
  private downPos = { x: 0, y: 0 };
  private moved = false;

  // Мультитач
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchPrev: { dist: number; midX: number; midY: number } | null = null;

  // Поиск
  private runner: AStarRunner | null = null;
  private searchRAF = 0;
  private searchRunning = false;
  private searchSpeed = 200;
  private searchAccumulator = 0;
  private searchLastTime = 0;

  onStats: (s: CityStats) => void = () => {};
  onSearch: (s: CitySearchState) => void = () => {};
  onSelection: (s: CitySelection) => void = () => {};

  constructor(private canvas: HTMLCanvasElement, options: CityOptions = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D-контекст недоступен");
    this.ctx = ctx;
    this.options = options;

    this.resize();
    this.bindEvents();
    this.regenerate(options, true);
  }

  // ---------- Геометрия вьюпорта ----------
  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private get viewW() {
    return this.canvas.width / this.dpr;
  }
  private get viewH() {
    return this.canvas.height / this.dpr;
  }

  private worldToScreen(x: number, y: number) {
    return { x: x * this.scale + this.offsetX, y: y * this.scale + this.offsetY };
  }
  private screenToWorld(px: number, py: number) {
    return { x: (px - this.offsetX) / this.scale, y: (py - this.offsetY) / this.scale };
  }

  private fitToBounds(margin = 0.86) {
    const b = this.data.bounds;
    const spanX = b.maxX - b.minX || 1;
    const spanY = b.maxY - b.minY || 1;
    this.scale = Math.min(this.viewW / spanX, this.viewH / spanY) * margin;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.offsetX = this.viewW / 2 - cx * this.scale;
    this.offsetY = this.viewH / 2 - cy * this.scale;
  }

  resetView() {
    this.fitToBounds();
    this.render();
    this.emitStats();
  }

  // ---------- Генерация ----------
  regenerate(options: CityOptions = this.options, randomPoints = true) {
    this.clearSearch(false);
    this.options = options;
    this.data = generateMoscowGraph(options);
    this.startId = null;
    this.goalId = null;
    this.hoverId = null;
    this.fitToBounds();
    if (randomPoints) this.pickRandomPair();
    this.render();
    this.emitStats();
    this.emitSelection();
  }

  /** Перевыбрать случайные A и B на текущем городе (без перегенерации). */
  randomizePoints() {
    this.clearSearch(false);
    this.startId = null;
    this.goalId = null;
    this.pickRandomPair();
    this.render();
    this.emitSelection();
  }

  /** Случайные старт/финиш, между которыми существует путь (несколько попыток). */
  private pickRandomPair() {
    const ids = [...this.data.nodes.keys()];
    if (ids.length < 2) return;
    const minSpan = (this.data.bounds.maxX - this.data.bounds.minX) * 0.4;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = ids[Math.floor(Math.random() * ids.length)];
      const b = ids[Math.floor(Math.random() * ids.length)];
      if (a === b) continue;
      const na = this.data.nodes.get(a)!;
      const nb = this.data.nodes.get(b)!;
      // хотим, чтобы точки были подальше друг от друга — интереснее путь
      if (Math.hypot(nb.x - na.x, nb.y - na.y) < minSpan) continue;
      if (astar(this.data.graph, this.data.nodes, a, b).path) {
        this.startId = a;
        this.goalId = b;
        return;
      }
    }
    // запасной вариант: любые две связанные точки
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        if (astar(this.data.graph, this.data.nodes, a, b).path) {
          this.startId = a;
          this.goalId = b;
          return;
        }
      }
    }
  }

  // ---------- Выбор точек ----------
  private nearestNode(worldX: number, worldY: number, maxDistPx = 26): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    const maxWorld = maxDistPx / this.scale;
    for (const n of this.data.nodes.values()) {
      const d = Math.hypot(n.x - worldX, n.y - worldY);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return bestD <= maxWorld ? best : null;
  }

  private handleClick(px: number, py: number) {
    const w = this.screenToWorld(px, py);
    const hit = this.nearestNode(w.x, w.y);
    if (!hit) return;

    this.clearSearch(false);
    // Логика: если оба заданы — начинаем заново со старта.
    if (this.startId && this.goalId) {
      this.startId = hit;
      this.goalId = null;
    } else if (!this.startId) {
      this.startId = hit;
    } else if (hit !== this.startId) {
      this.goalId = hit;
    }
    this.render();
    this.emitSelection();
  }

  clearSelection() {
    this.clearSearch(false);
    this.startId = null;
    this.goalId = null;
    this.render();
    this.emitSelection();
  }

  private emitSelection() {
    this.onSelection({
      start: this.startId,
      goal: this.goalId,
      next: !this.startId || (this.startId && this.goalId) ? "start" : "goal",
    });
  }

  // ---------- Поиск ----------
  setSpeed(nodesPerSecond: number) {
    this.searchSpeed = Math.max(0.5, nodesPerSecond);
  }

  clearSearch(rerender = true) {
    if (this.searchRAF) cancelAnimationFrame(this.searchRAF);
    this.searchRAF = 0;
    this.searchRunning = false;
    this.runner = null;
    this.emitSearch();
    if (rerender) this.render();
  }

  startSearch(): { ok: boolean; reason?: string } {
    if (!this.startId || !this.goalId) {
      return { ok: false, reason: "Выбери точку A и точку B (клик по перекрёсткам)" };
    }
    if (this.searchRAF) cancelAnimationFrame(this.searchRAF);
    this.runner = new AStarRunner(
      this.data.graph,
      this.data.nodes,
      this.startId,
      this.goalId
    );
    this.searchRunning = true;
    this.searchAccumulator = 0;
    this.searchLastTime = 0;
    this.emitSearch();

    const MAX_STEPS_PER_FRAME = 4000;
    const animate = (now: number) => {
      if (!this.runner) return;
      if (!this.searchLastTime) this.searchLastTime = now;
      const dt = Math.min(0.1, (now - this.searchLastTime) / 1000);
      this.searchLastTime = now;
      this.searchAccumulator += dt * this.searchSpeed;

      let alive = true;
      let done = 0;
      while (this.searchAccumulator >= 1 && alive && done < MAX_STEPS_PER_FRAME) {
        alive = this.runner.step();
        this.searchAccumulator -= 1;
        done++;
      }

      this.render();
      this.emitSearch();
      if (alive) {
        this.searchRAF = requestAnimationFrame(animate);
      } else {
        this.searchRAF = 0;
        this.searchRunning = false;
        this.emitSearch();
      }
    };
    this.searchRAF = requestAnimationFrame(animate);
    return { ok: true };
  }

  private emitSearch() {
    const r = this.runner;
    this.onSearch({
      running: this.searchRunning,
      finished: r?.finished ?? false,
      found: r?.found ?? false,
      open: r?.open.size ?? 0,
      closed: r?.closed.size ?? 0,
      pathNodes: r?.path?.length ?? 0,
      pathCost: r?.pathCost ?? 0,
    });
  }

  private emitStats() {
    let edges = 0;
    for (const list of this.data.graph.values()) edges += list.length;
    this.onStats({
      nodes: this.data.nodes.size,
      edges: edges / 2,
      scalePercent: Math.round(this.scale * 100),
      hoverId: this.hoverId,
    });
  }

  // ---------- События ----------
  private bindEvents() {
    const c = this.canvas;
    window.addEventListener("resize", () => {
      this.resize();
      this.render();
    });
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const p = this.localPos(e);
      this.pointers.set(e.pointerId, p);
      this.lastPointer = p;
      this.downPos = p;
      this.moved = false;

      if (this.pointers.size === 2) {
        this.beginPinch();
        return;
      }
      if (this.pointers.size > 2) return;
      this.isPanning = true;
    });

    c.addEventListener("pointermove", (e) => {
      const p = this.localPos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

      if (this.pinchPrev && this.pointers.size >= 2) {
        this.updatePinch();
        return;
      }

      if (this.isPanning) {
        const dx = p.x - this.lastPointer.x;
        const dy = p.y - this.lastPointer.y;
        if (Math.abs(p.x - this.downPos.x) + Math.abs(p.y - this.downPos.y) > 4)
          this.moved = true;
        this.offsetX += dx;
        this.offsetY += dy;
        this.lastPointer = p;
        this.render();
        this.emitStats();
        return;
      }

      // Наведение — подсветка ближайшего перекрёстка
      const w = this.screenToWorld(p.x, p.y);
      const hit = this.nearestNode(w.x, w.y);
      if (hit !== this.hoverId) {
        this.hoverId = hit;
        this.render();
        this.emitStats();
      }
    });

    const stop = (e: PointerEvent) => {
      const wasPanning = this.isPanning;
      const moved = this.moved;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchPrev = null;
      this.isPanning = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // Клик без перетаскивания — выбор точки.
      if (wasPanning && !moved && this.pointers.size === 0) {
        const p = this.localPos(e);
        this.handleClick(p.x, p.y);
      }
    };
    c.addEventListener("pointerup", stop);
    c.addEventListener("pointercancel", stop);

    c.addEventListener("pointerleave", () => {
      if (this.hoverId !== null) {
        this.hoverId = null;
        this.render();
        this.emitStats();
      }
    });

    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const worldX = (e.offsetX - this.offsetX) / this.scale;
        const worldY = (e.offsetY - this.offsetY) / this.scale;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
        this.offsetX = e.offsetX - worldX * this.scale;
        this.offsetY = e.offsetY - worldY * this.scale;
        this.render();
        this.emitStats();
      },
      { passive: false }
    );
  }

  private localPos(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pinchMetrics() {
    const [a, b] = [...this.pointers.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }
  private beginPinch() {
    this.isPanning = false;
    this.pinchPrev = this.pinchMetrics();
  }
  private updatePinch() {
    if (!this.pinchPrev) return;
    const cur = this.pinchMetrics();
    const prev = this.pinchPrev;
    this.offsetX += cur.midX - prev.midX;
    this.offsetY += cur.midY - prev.midY;
    const factor = cur.dist / prev.dist;
    const worldX = (cur.midX - this.offsetX) / this.scale;
    const worldY = (cur.midY - this.offsetY) / this.scale;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.offsetX = cur.midX - worldX * this.scale;
    this.offsetY = cur.midY - worldY * this.scale;
    this.pinchPrev = cur;
    this.render();
    this.emitStats();
  }

  // ---------- Рендер ----------
  render() {
    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    this.drawRiver();
    this.drawEdges();
    this.drawSearchOverlay();
    this.drawNodes();
    this.drawMarkers();
  }

  private drawRiver() {
    const ctx = this.ctx;
    const river = this.data.river;
    if (river.length < 2) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Внешняя «набережная»
    ctx.strokeStyle = COLORS.waterEdge;
    ctx.lineWidth = this.data.riverWidth * this.scale + 6;
    this.strokePath(river);

    // Вода
    ctx.strokeStyle = COLORS.water;
    ctx.lineWidth = this.data.riverWidth * this.scale;
    this.strokePath(river);
    ctx.restore();
  }

  private strokePath(pts: { x: number; y: number }[]) {
    const ctx = this.ctx;
    ctx.beginPath();
    const p0 = this.worldToScreen(pts[0].x, pts[0].y);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = this.worldToScreen(pts[i].x, pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  private drawEdges() {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    // рисуем каждое неориентированное ребро один раз (a.id < b.id)
    for (const [from, list] of this.data.graph) {
      const a = this.data.nodes.get(from)!;
      for (const edge of list) {
        if (from >= edge.to) continue;
        const b = this.data.nodes.get(edge.to)!;
        const pa = this.worldToScreen(a.x, a.y);
        const pb = this.worldToScreen(b.x, b.y);
        if (edge.bridge) {
          ctx.strokeStyle = COLORS.bridge;
          ctx.lineWidth = Math.max(1.5, 3 * this.scale);
        } else if (edge.major) {
          ctx.strokeStyle = COLORS.roadMajor;
          ctx.lineWidth = Math.max(1.2, 2.4 * this.scale);
        } else {
          ctx.strokeStyle = COLORS.roadNormal;
          ctx.lineWidth = Math.max(0.6, 1.2 * this.scale);
        }
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }
  }

  private drawSearchOverlay() {
    const r = this.runner;
    if (!r) return;
    const ctx = this.ctx;

    // Рёбра дерева поиска (cameFrom) для просмотренных вершин
    ctx.strokeStyle = SEARCH_TREE_EDGE;
    ctx.lineWidth = Math.max(1, 1.6 * this.scale);
    ctx.beginPath();
    for (const [to, from] of r.cameFrom) {
      if (!r.closed.has(to) && !r.open.has(to)) continue;
      const a = this.data.nodes.get(from)!;
      const b = this.data.nodes.get(to)!;
      const pa = this.worldToScreen(a.x, a.y);
      const pb = this.worldToScreen(b.x, b.y);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    const dot = (id: string, color: string, rad: number) => {
      const n = this.data.nodes.get(id)!;
      const p = this.worldToScreen(n.x, n.y);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    };

    const cr = Math.max(2, 2.6 * this.scale);
    for (const id of r.closed) dot(id, COLORS.closed, cr);
    for (const id of r.open) dot(id, COLORS.open, cr);

    // Найденный путь
    if (r.path && r.path.length > 1) {
      ctx.strokeStyle = COLORS.pathEdge;
      ctx.lineWidth = Math.max(2.5, 4 * this.scale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < r.path.length; i++) {
        const n = this.data.nodes.get(r.path[i])!;
        const p = this.worldToScreen(n.x, n.y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      for (const id of r.path) dot(id, COLORS.pathNode, Math.max(2.5, 3 * this.scale));
    } else if (r.current && !r.finished) {
      dot(r.current, COLORS.current, Math.max(3, 3.4 * this.scale));
    }
  }

  private drawNodes() {
    const ctx = this.ctx;
    const rad = Math.max(0.8, 1.5 * this.scale);
    if (rad < 1.2 && !this.hoverId) return; // при сильном отдалении точки не рисуем
    ctx.fillStyle = COLORS.node;
    for (const n of this.data.nodes.values()) {
      const p = this.worldToScreen(n.x, n.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.hoverId) {
      const n = this.data.nodes.get(this.hoverId)!;
      const p = this.worldToScreen(n.x, n.y);
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(6, 4 * this.scale), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawMarkers() {
    if (this.startId) this.drawMarker(this.startId, COLORS.start, "A");
    if (this.goalId) this.drawMarker(this.goalId, COLORS.goal, "B");
  }

  private drawMarker(id: string, color: string, label: string) {
    const n = this.data.nodes.get(id);
    if (!n) return;
    const ctx = this.ctx;
    const p = this.worldToScreen(n.x, n.y);
    const r = 11;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 13px Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, p.y + 1);
  }

}

export type { CityNode };
