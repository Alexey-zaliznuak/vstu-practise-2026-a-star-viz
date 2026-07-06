export type Tool = "start" | "erase" | "end" | "wall";

export interface Cell {
  x: number;
  y: number;
}

export interface GridStats {
  start: Cell | null;
  end: Cell | null;
  walls: number;
  hover: Cell | null;
  cellSize: number;
}

export interface SearchState {
  running: boolean;
  finished: boolean;
  found: boolean;
  open: number;
  closed: number;
  pathLength: number;
}

export interface MapExport {
  start: Cell | null;
  end: Cell | null;
  walls: [number, number][];
}

const COLORS = {
  bg: "#fbfaff",
  line: "#ece7f6",
  lineBold: "#ddd5ee",
  start: "#2196f3",
  end: "#f44336",
  wall: "#212121",
  hover: "rgba(103, 80, 164, 0.14)",
  hoverBorder: "rgba(103, 80, 164, 0.55)",
  open: "#26c6da", // фронтир (open set) — бирюзовый
  closed: "#ce93d8", // просмотренные (closed set) — сиреневый
  path: "#ffd600", // найденный путь — жёлтый
};

// Насколько расширяем зону поиска вокруг рамки старт↔финиш (клетки).
const SEARCH_PADDING = 40;

const key = (x: number, y: number) => `${x},${y}`;

/**
 * Бесконечная сетка на canvas.
 * В памяти храним только "не белые" клетки: стены (Set) и по одной старт/финиш.
 */
export class GridEditor {
  private ctx: CanvasRenderingContext2D;
  private dpr = window.devicePixelRatio || 1;

  // Модель карты
  private walls = new Set<string>();
  private start: Cell | null = null;
  private end: Cell | null = null;

  // Вьюпорт: смещение сетки в пикселях + размер клетки (зум)
  private offsetX = 0;
  private offsetY = 0;
  private cellSize = 40;
  private readonly minCell = 0.05; // отдаление практически без ограничений
  private readonly maxCell = 120;

  private hover: Cell | null = null;
  private tool: Tool | null = "wall";

  // Панорамирование / рисование
  private isPanning = false;
  private isPainting = false;
  private lastPointer = { x: 0, y: 0 };
  private paintValue: Tool = "wall";

  // Мультитач: активные указатели и состояние пинч-жеста
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchPrev: { dist: number; midX: number; midY: number } | null = null;

  // Состояние визуализации поиска
  private searchOpen = new Set<string>();
  private searchClosed = new Set<string>();
  private searchPath = new Set<string>();
  private searchRAF = 0;
  private searchRunning = false;
  private searchFinished = false;
  private searchFound = false;

  onStats: (s: GridStats) => void = () => {};
  onPanState: (panning: boolean) => void = () => {};
  onSearch: (s: SearchState) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D-контекст недоступен");
    this.ctx = ctx;

    this.resize();
    // Центрируем сетку так, чтобы клетка (0,0) была в левом-верхнем углу с отступом
    this.offsetX = 80;
    this.offsetY = 80;

    this.bindEvents();
    this.render();
  }

  setTool(tool: Tool | null) {
    this.tool = tool;
  }

  // ---------- Геометрия ----------
  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private get viewW() {
    return this.canvas.width / this.dpr;
  }
  private get viewH() {
    return this.canvas.height / this.dpr;
  }

  private screenToCell(px: number, py: number): Cell {
    const x = Math.floor((px - this.offsetX) / this.cellSize);
    const y = Math.floor((py - this.offsetY) / this.cellSize);
    return { x, y };
  }

  /**
   * Координаты указателя относительно canvas (в CSS-пикселях).
   * Считаем через getBoundingClientRect, т.к. e.offsetX/offsetY у pointer-событий
   * на iOS Safari работают ненадёжно.
   */
  private localPos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---------- Модель ----------
  private paintCell(cell: Cell, value: Tool) {
    // любое редактирование карты сбрасывает прошлый результат поиска
    this.clearSearch(false);
    const k = key(cell.x, cell.y);
    switch (value) {
      case "wall":
        this.clearSpecial(cell);
        this.walls.add(k);
        break;
      case "erase":
        this.walls.delete(k);
        this.clearSpecial(cell);
        break;
      case "start":
        // старт может быть только один
        this.walls.delete(k);
        if (this.end && this.end.x === cell.x && this.end.y === cell.y)
          this.end = null;
        this.start = { ...cell };
        break;
      case "end":
        this.walls.delete(k);
        if (this.start && this.start.x === cell.x && this.start.y === cell.y)
          this.start = null;
        this.end = { ...cell };
        break;
    }
    this.render();
    this.emitStats();
  }

  private clearSpecial(cell: Cell) {
    if (this.start && this.start.x === cell.x && this.start.y === cell.y)
      this.start = null;
    if (this.end && this.end.x === cell.x && this.end.y === cell.y)
      this.end = null;
  }

  clearAll() {
    this.clearSearch(false);
    this.walls.clear();
    this.start = null;
    this.end = null;
    this.render();
    this.emitStats();
  }

  // ---------- Поиск (Дейкстра) ----------
  clearSearch(rerender = true) {
    if (this.searchRAF) cancelAnimationFrame(this.searchRAF);
    this.searchRAF = 0;
    this.searchRunning = false;
    this.searchFinished = false;
    this.searchFound = false;
    this.searchOpen.clear();
    this.searchClosed.clear();
    this.searchPath.clear();
    this.emitSearch();
    if (rerender) {
      this.render();
      this.emitStats();
    }
  }

  private emitSearch() {
    this.onSearch({
      running: this.searchRunning,
      finished: this.searchFinished,
      found: this.searchFound,
      open: this.searchOpen.size,
      closed: this.searchClosed.size,
      pathLength: this.searchPath.size,
    });
  }

  /** Запуск визуализации A* (эвристика — манхэттенское расстояние) от старта к финишу. */
  startSearch(): { ok: boolean; reason?: string } {
    if (!this.start || !this.end) {
      return { ok: false, reason: "Поставь старт (A) и финиш (B)" };
    }
    this.clearSearch(false);

    const start = this.start;
    const end = this.end;

    // Ограничиваем зону поиска рамкой вокруг старта/финиша,
    // иначе на бесконечном поле без пути алгоритм не завершится.
    // min wall pos
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const wall of [...this.walls, key(start.x, start.y), key(end.x, end.y)]) {
      const [x, y] = wall.split(",").map(Number);
      minX = Math.min(minX, x) - SEARCH_PADDING;
      maxX = Math.max(maxX, x) + SEARCH_PADDING;
      minY = Math.min(minY, y) - SEARCH_PADDING;
      maxY = Math.max(maxY, y) + SEARCH_PADDING;
    }

    // g — стоимость пути от старта; h — манхэттенская эвристика до финиша.
    const dist = new Map<string, number>();
    const cameFrom = new Map<string, string>();
    const heap = new MinHeap();

    const heuristic = (x: number, y: number) =>
      Math.abs(x - end.x) + Math.abs(y - end.y);

    const startKey = key(start.x, start.y);
    const endKey = key(end.x, end.y);
    dist.set(startKey, 0);
    heap.push(startKey, heuristic(start.x, start.y));
    this.searchOpen.add(startKey);

    const neighbors = (x: number, y: number): [number, number][] => [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    this.searchRunning = true;
    this.emitSearch();

    // Один шаг алгоритма (обработка одной вершины). Возвращает false, когда пора остановиться.
    const step = (): boolean => {
      const current = heap.pop();

      if (!current) {
        this.searchFinished = true;
        this.searchRunning = false;
        console.log("searchFinished, reason - no heap items");
        return false;
      }

      const ck = current.key;

      if (this.searchClosed.has(ck)) return true; // устаревшая запись из кучи

      this.searchOpen.delete(ck);
      this.searchClosed.add(ck);

      if (ck === endKey) {
        this.reconstructPath(cameFrom, endKey);
        this.searchFound = true;
        this.searchFinished = true;
        this.searchRunning = false;
        return false;
      }

      const [cx, cy] = ck.split(",").map(Number);
      const g = dist.get(ck) ?? 0;
      for (const [nx, ny] of neighbors(cx, cy)) {
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const nk = key(nx, ny);
        if (this.walls.has(nk) || this.searchClosed.has(nk)) continue;
        const ng = g + 1; // равномерная стоимость шага
        if (ng < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, ng);
          cameFrom.set(nk, ck);
          heap.push(nk, ng + heuristic(nx, ny)); // приоритет A*: f = g + h
          this.searchOpen.add(nk);
        }
      }
      return true;
    };

    // Анимация: несколько шагов за кадр, чтобы было видно распространение волны.
    const animate = () => {
      const stepsPerFrame = 6;
      let alive = true;
      for (let i = 0; i < stepsPerFrame && alive; i++) alive = step();
      this.render();
      this.emitSearch();
      if (alive) {
        this.searchRAF = requestAnimationFrame(animate);
      } else {
        this.searchRAF = 0;
        this.emitStats();
      }
    };
    this.searchRAF = requestAnimationFrame(animate);
    return { ok: true };
  }

  private reconstructPath(cameFrom: Map<string, string>, endKey: string) {
    let cur: string | undefined = endKey;
    while (cur) {
      this.searchPath.add(cur);
      cur = cameFrom.get(cur);
    }
  }

  /** Случайная карта в квадрате [-50..50] x [-50..50]. */
  generateRandom(density = 0.28) {
    this.clearSearch(false);
    this.walls.clear();
    this.start = null;
    this.end = null;

    const min = -50;
    const max = 50;
    const rnd = (lo: number, hi: number) =>
      Math.floor(Math.random() * (hi - lo + 1)) + lo;

    // старт и финиш — в разных углах, чтобы путь был подлиннее
    this.start = { x: rnd(min, -20), y: rnd(min, -20) };
    this.end = { x: rnd(20, max), y: rnd(20, max) };

    for (let x = min; x <= max; x++) {
      for (let y = min; y <= max; y++) {
        if (Math.random() >= density) continue;
        if (x === this.start.x && y === this.start.y) continue;
        if (x === this.end.x && y === this.end.y) continue;
        this.walls.add(key(x, y));
      }
    }

    this.fitToBounds(min, min, max, max);
    this.render();
    this.emitStats();
  }

  /** Подгоняет масштаб и смещение так, чтобы прямоугольник клеток целиком поместился по центру. */
  private fitToBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    margin = 0.92
  ) {
    const spanX = maxX - minX + 1;
    const spanY = maxY - minY + 1;
    const size = Math.min(this.viewW / spanX, this.viewH / spanY) * margin;
    this.cellSize = Math.min(this.maxCell, Math.max(this.minCell, size));

    // центр прямоугольника в «мировых» единицах клеток
    const centerX = (minX + maxX + 1) / 2;
    const centerY = (minY + maxY + 1) / 2;
    this.offsetX = this.viewW / 2 - centerX * this.cellSize;
    this.offsetY = this.viewH / 2 - centerY * this.cellSize;
  }

  resetView() {
    this.cellSize = 40;
    this.offsetX = 80;
    this.offsetY = 80;
    this.render();
    this.emitStats();
  }

  exportMap(): MapExport {
    return {
      start: this.start,
      end: this.end,
      walls: [...this.walls].map((k) => {
        const [x, y] = k.split(",").map(Number);
        return [x, y] as [number, number];
      }),
    };
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

      // Второй палец — переходим в жест пинч-зума/панорамы (тач)
      if (this.pointers.size === 2) {
        this.isPainting = false;
        this.beginPinch();
        return;
      }
      if (this.pointers.size > 2) return;

      // ПКМ / средняя / Shift, а также ЛКМ без выбранного инструмента — панорама
      const panButton =
        e.button === 1 || e.button === 2 || e.shiftKey || this.tool === null;
      if (panButton) {
        this.isPanning = true;
        this.onPanState(true);
        return;
      }
      if (e.button === 0 && this.tool) {
        this.isPainting = true;
        this.paintValue = this.tool;
        this.paintCell(this.screenToCell(p.x, p.y), this.paintValue);
      }
    });

    c.addEventListener("pointermove", (e) => {
      const p = this.localPos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

      // Пинч-зум двумя пальцами
      if (this.pinchPrev && this.pointers.size >= 2) {
        this.updatePinch();
        return;
      }

      const cell = this.screenToCell(p.x, p.y);
      this.hover = cell;

      if (this.isPanning) {
        this.offsetX += p.x - this.lastPointer.x;
        this.offsetY += p.y - this.lastPointer.y;
        this.lastPointer = p;
        this.render();
        this.emitStats();
        return;
      }

      if (this.isPainting) {
        // не даём тащить старт/финиш кистью — красим их только точечно
        if (this.paintValue === "wall" || this.paintValue === "erase") {
          this.paintCell(cell, this.paintValue);
          return;
        }
      }
      this.render();
      this.emitStats();
    });

    const stop = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchPrev = null;
      if (this.isPanning) {
        this.isPanning = false;
        this.onPanState(false);
      }
      this.isPainting = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    c.addEventListener("pointerup", stop);
    c.addEventListener("pointercancel", stop);

    c.addEventListener("pointerleave", () => {
      this.hover = null;
      this.render();
      this.emitStats();
    });

    // Зум колесом к точке под курсором
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const worldX = (e.offsetX - this.offsetX) / this.cellSize;
        const worldY = (e.offsetY - this.offsetY) / this.cellSize;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.min(
          this.maxCell,
          Math.max(this.minCell, this.cellSize * factor)
        );
        this.cellSize = next;
        this.offsetX = e.offsetX - worldX * this.cellSize;
        this.offsetY = e.offsetY - worldY * this.cellSize;
        this.render();
        this.emitStats();
      },
      { passive: false }
    );
  }

  private pinchMetrics(): { dist: number; midX: number; midY: number } {
    const [a, b] = [...this.pointers.values()];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return {
      dist: Math.hypot(dx, dy) || 1,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  private beginPinch() {
    this.isPanning = false;
    this.onPanState(false);
    this.pinchPrev = this.pinchMetrics();
  }

  /** Масштабирование + панорама двумя пальцами относительно средней точки. */
  private updatePinch() {
    if (!this.pinchPrev) return;
    const cur = this.pinchMetrics();
    const prev = this.pinchPrev;

    // 1) панорама вслед за перемещением средней точки
    this.offsetX += cur.midX - prev.midX;
    this.offsetY += cur.midY - prev.midY;

    // 2) зум относительно текущей средней точки
    const factor = cur.dist / prev.dist;
    const next = Math.min(
      this.maxCell,
      Math.max(this.minCell, this.cellSize * factor)
    );
    const worldX = (cur.midX - this.offsetX) / this.cellSize;
    const worldY = (cur.midY - this.offsetY) / this.cellSize;
    this.cellSize = next;
    this.offsetX = cur.midX - worldX * this.cellSize;
    this.offsetY = cur.midY - worldY * this.cellSize;

    this.pinchPrev = cur;
    this.render();
    this.emitStats();
  }

  private emitStats() {
    this.onStats({
      start: this.start,
      end: this.end,
      walls: this.walls.size,
      hover: this.hover,
      cellSize: Math.round(this.cellSize),
    });
  }

  // ---------- Рендер ----------
  render() {
    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;
    const s = this.cellSize;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Диапазон видимых клеток
    const minX = Math.floor(-this.offsetX / s);
    const minY = Math.floor(-this.offsetY / s);
    const maxX = Math.ceil((w - this.offsetX) / s);
    const maxY = Math.ceil((h - this.offsetY) / s);

    // Линии сетки (при сильном отдалении не рисуем — их всё равно не видно и это тормозит)
    const drawLines = s >= 5;
    ctx.lineWidth = 1;
    for (let x = minX; drawLines && x <= maxX; x++) {
      const px = Math.round(this.offsetX + x * s) + 0.5;
      ctx.strokeStyle = x % 5 === 0 ? COLORS.lineBold : COLORS.line;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let y = minY; drawLines && y <= maxY; y++) {
      const py = Math.round(this.offsetY + y * s) + 0.5;
      ctx.strokeStyle = y % 5 === 0 ? COLORS.lineBold : COLORS.line;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Слой визуализации поиска (под стенами и старт/финишем)
    const inView = (k: string) => {
      const [cx, cy] = k.split(",").map(Number);
      return !(cx < minX - 1 || cx > maxX || cy < minY - 1 || cy > maxY);
    };
    for (const k of this.searchClosed) {
      if (this.searchPath.has(k) || !inView(k)) continue;
      const [cx, cy] = k.split(",").map(Number);
      this.fillCell(cx, cy, COLORS.closed, 0.14);
    }
    for (const k of this.searchOpen) {
      if (!inView(k)) continue;
      const [cx, cy] = k.split(",").map(Number);
      this.fillCell(cx, cy, COLORS.open, 0.14);
    }
    for (const k of this.searchPath) {
      if (!inView(k)) continue;
      const [cx, cy] = k.split(",").map(Number);
      this.fillCell(cx, cy, COLORS.path, 0.14);
    }

    // Стены
    ctx.fillStyle = COLORS.wall;
    for (const k of this.walls) {
      const [cx, cy] = k.split(",").map(Number);
      if (cx < minX - 1 || cx > maxX || cy < minY - 1 || cy > maxY) continue;
      this.fillCell(cx, cy, COLORS.wall, 0.12);
    }

    // Старт / финиш
    if (this.start) this.fillCell(this.start.x, this.start.y, COLORS.start, 0.2, "A");
    if (this.end) this.fillCell(this.end.x, this.end.y, COLORS.end, 0.2, "B");

    // Подсветка клетки под курсором
    if (this.hover && !this.isPanning) {
      const hx = this.offsetX + this.hover.x * s;
      const hy = this.offsetY + this.hover.y * s;
      ctx.fillStyle = COLORS.hover;
      ctx.fillRect(hx, hy, s, s);
      ctx.strokeStyle = COLORS.hoverBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(hx + 1, hy + 1, s - 2, s - 2);
    }
  }

  private fillCell(
    cx: number,
    cy: number,
    color: string,
    radiusRatio: number,
    label?: string
  ) {
    const ctx = this.ctx;
    const s = this.cellSize;
    const px = this.offsetX + cx * s;
    const py = this.offsetY + cy * s;
    const pad = Math.max(1, s * 0.06);
    const r = Math.min(s * radiusRatio, s / 2);

    ctx.fillStyle = color;
    this.roundRect(px + pad, py + pad, s - pad * 2, s - pad * 2, r);
    ctx.fill();

    if (label && s >= 22) {
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(s * 0.42)}px Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px + s / 2, py + s / 2 + 1);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/** Бинарная мин-куча по приоритету f = g + h (для A*). */
class MinHeap {
  private items: { key: string; priority: number }[] = [];

  get size() {
    return this.items.length;
  }

  push(key: string, priority: number) {
    const items = this.items;
    items.push({ key, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): { key: string; priority: number } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && items[l].priority < items[smallest].priority) smallest = l;
        if (r < n && items[r].priority < items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}
