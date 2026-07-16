import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MinHeap } from "./grid";

export interface Cell3D {
  x: number;
  y: number;
  z: number;
}

export interface Search3DState {
  running: boolean;
  finished: boolean;
  found: boolean;
  open: number;
  closed: number;
  pathLength: number;
}

const COLORS = {
  wall: 0x707078,
  start: 0x2196f3,
  end: 0xf44336,
  open: 0x26c6da,
  closed: 0xce93d8,
  path: 0xffd600,
};

const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Трёхмерный вьювер сетки на three.js (режим «только визуализация»).
 * Генерирует куб size×size×size со случайными препятствиями, ставит
 * старт/финиш в противоположных углах и анимирует поиск A* с 6-связностью.
 */
export class Grid3DViewer {
  // --- three.js ---
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls | null = null;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId = 0;

  // Геометрия сцены (пересоздаётся при генерации карты)
  private mapGroup = new THREE.Group();
  private wallMesh: THREE.InstancedMesh | null = null;
  private closedMesh: THREE.InstancedMesh | null = null;
  private openMesh: THREE.InstancedMesh | null = null;
  private pathMesh: THREE.InstancedMesh | null = null;
  private startMesh: THREE.Mesh | null = null;
  private endMesh: THREE.Mesh | null = null;
  private dummy = new THREE.Object3D();

  // --- Модель карты ---
  private size = 15;
  private walls = new Set<string>();
  private start: Cell3D | null = null;
  private end: Cell3D | null = null;

  // --- Состояние поиска A* ---
  private searchOpen = new Set<string>();
  private searchClosed = new Set<string>();
  private searchPath = new Set<string>();
  private cameFrom = new Map<string, string>();
  private dist = new Map<string, number>();
  private heap = new MinHeap();
  private endKey = "";
  private searchRunning = false;
  private searchFinished = false;
  private searchFound = false;
  private overlayDirty = false;

  // Скорость визуализации: вершин в секунду (как в 2D-редакторе).
  private searchSpeed = 50;
  private searchAccumulator = 0;
  private searchLastTime = 0;

  onSearch: (s: Search3DState) => void = () => {};

  constructor() {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.scene.background = new THREE.Color(0xf3f1fb);
    this.scene.add(this.mapGroup);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(1, 1.4, 0.8);
    this.scene.add(ambient, dir);
  }

  /** Подключает рендерер к DOM-контейнеру и запускает цикл отрисовки. */
  mount(container: HTMLElement) {
    if (this.renderer) return;
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer = renderer;
    container.appendChild(renderer.domElement);

    const orbit = new OrbitControls(this.camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    this.orbit = orbit;

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      this.tick(now);
      this.orbit?.update();
      this.renderer!.render(this.scene, this.camera);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  setSpeed(verticesPerSecond: number) {
    this.searchSpeed = Math.max(0.01, verticesPerSecond);
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private get center() {
    return (this.size - 1) / 2;
  }

  private worldPos(x: number, y: number, z: number) {
    const c = this.center;
    return new THREE.Vector3(x - c, y - c, z - c);
  }

  // ---------- Генерация ----------
  /**
   * Случайный куб size×size×size. Старт и финиш — в противоположных углах.
   * @param density доля ячеек-стен (0..1)
   * @param size сторона куба
   */
  generateRandom(density = 0.28, size = 15) {
    this.size = Math.max(2, Math.floor(size));
    this.clearSearchState();
    this.walls.clear();

    const n = this.size;
    const rnd = (lo: number, hi: number) =>
      Math.floor(Math.random() * (hi - lo + 1)) + lo;
    const corner = Math.max(0, Math.floor(n * 0.15));
    this.start = { x: rnd(0, corner), y: rnd(0, corner), z: rnd(0, corner) };
    this.end = {
      x: rnd(n - 1 - corner, n - 1),
      y: rnd(n - 1 - corner, n - 1),
      z: rnd(n - 1 - corner, n - 1),
    };

    const isSpecial = (x: number, y: number, z: number) =>
      (x === this.start!.x && y === this.start!.y && z === this.start!.z) ||
      (x === this.end!.x && y === this.end!.y && z === this.end!.z);

    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        for (let z = 0; z < n; z++) {
          if (Math.random() >= density) continue;
          if (isSpecial(x, y, z)) continue;
          this.walls.add(key3(x, y, z));
        }
      }
    }

    this.rebuildScene();
    this.fitCamera();
    this.emitSearch();
  }

  private disposeMesh(mesh: THREE.InstancedMesh | THREE.Mesh | null) {
    if (!mesh) return;
    this.mapGroup.remove(mesh);
    mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  }

  private makeLayer(color: number, boxSize: number, opacity: number) {
    const cap = Math.max(1, this.size ** 3);
    const geo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const mat = new THREE.MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.mapGroup.add(mesh);
    return mesh;
  }

  /** Полностью пересобирает геометрию сцены под текущую модель. */
  private rebuildScene() {
    // Очищаем прошлые объекты
    while (this.mapGroup.children.length) {
      const child = this.mapGroup.children[0] as THREE.Mesh | THREE.LineSegments;
      this.mapGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
      const m = (child as THREE.Mesh).material;
      if (m) {
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else (m as THREE.Material).dispose();
      }
    }

    // Рамка куба
    const n = this.size;
    const box = new THREE.BoxGeometry(n, n, n);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const frame = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xb7aede })
    );
    this.mapGroup.add(frame);

    // Слои поиска (рисуем под стенами по порядку добавления не важен — z-buffer)
    this.closedMesh = this.makeLayer(COLORS.closed, 0.55, 0.35);
    this.openMesh = this.makeLayer(COLORS.open, 0.62, 0.5);
    this.pathMesh = this.makeLayer(COLORS.path, 0.8, 0.95);

    // Стены — полупрозрачный серый, чтобы видеть путь A* сквозь препятствия
    this.wallMesh = this.makeLayer(COLORS.wall, 0.9, 0.4);
    let i = 0;
    for (const k of this.walls) {
      const [x, y, z] = k.split(",").map(Number);
      this.dummy.position.copy(this.worldPos(x, y, z));
      this.dummy.updateMatrix();
      this.wallMesh.setMatrixAt(i++, this.dummy.matrix);
    }
    this.wallMesh.count = i;
    this.wallMesh.instanceMatrix.needsUpdate = true;

    // Старт / финиш
    const startGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    this.startMesh = new THREE.Mesh(
      startGeo,
      new THREE.MeshLambertMaterial({ color: COLORS.start })
    );
    const endGeo = new THREE.BoxGeometry(0.92, 0.92, 0.92);
    this.endMesh = new THREE.Mesh(
      endGeo,
      new THREE.MeshLambertMaterial({ color: COLORS.end })
    );
    if (this.start)
      this.startMesh.position.copy(
        this.worldPos(this.start.x, this.start.y, this.start.z)
      );
    if (this.end)
      this.endMesh.position.copy(
        this.worldPos(this.end.x, this.end.y, this.end.z)
      );
    this.mapGroup.add(this.startMesh, this.endMesh);

    this.overlayDirty = true;
  }

  private fitCamera() {
    const n = this.size;
    const dist = n * 1.9 + 3;
    this.camera.position.set(dist * 0.7, dist * 0.55, dist * 0.7);
    this.camera.lookAt(0, 0, 0);
    if (this.orbit) {
      this.orbit.target.set(0, 0, 0);
      this.orbit.update();
    }
  }

  // ---------- Поиск A* ----------
  private clearSearchState() {
    this.searchOpen.clear();
    this.searchClosed.clear();
    this.searchPath.clear();
    this.cameFrom.clear();
    this.dist.clear();
    this.heap = new MinHeap();
    this.searchRunning = false;
    this.searchFinished = false;
    this.searchFound = false;
    this.searchAccumulator = 0;
    this.searchLastTime = 0;
    this.overlayDirty = true;
  }

  clearSearch() {
    this.clearSearchState();
    this.emitSearch();
  }

  private heuristic(x: number, y: number, z: number) {
    const e = this.end!;
    return Math.abs(x - e.x) + Math.abs(y - e.y) + Math.abs(z - e.z);
  }

  /** Инициализирует и запускает визуализацию A* от старта к финишу. */
  startSearch(): { ok: boolean; reason?: string } {
    if (!this.start || !this.end) {
      return { ok: false, reason: "Сначала сгенерируй карту" };
    }
    this.clearSearchState();

    const s = this.start;
    const startKey = key3(s.x, s.y, s.z);
    this.endKey = key3(this.end.x, this.end.y, this.end.z);
    this.dist.set(startKey, 0);
    this.heap.push(startKey, this.heuristic(s.x, s.y, s.z));
    this.searchOpen.add(startKey);

    this.searchRunning = true;
    this.overlayDirty = true;
    this.emitSearch();
    return { ok: true };
  }

  private neighbors(x: number, y: number, z: number): [number, number, number][] {
    return [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1],
    ];
  }

  /** Один шаг алгоритма. Возвращает false, когда пора остановиться. */
  private step(): boolean {
    const current = this.heap.pop();
    if (!current) {
      this.searchFinished = true;
      this.searchRunning = false;
      return false;
    }
    const ck = current.key;
    if (this.searchClosed.has(ck)) return true;

    this.searchOpen.delete(ck);
    this.searchClosed.add(ck);

    if (ck === this.endKey) {
      this.reconstructPath(ck);
      this.searchFound = true;
      this.searchFinished = true;
      this.searchRunning = false;
      return false;
    }

    const [cx, cy, cz] = ck.split(",").map(Number);
    const g = this.dist.get(ck) ?? 0;
    const n = this.size;
    for (const [nx, ny, nz] of this.neighbors(cx, cy, cz)) {
      if (nx < 0 || nx >= n || ny < 0 || ny >= n || nz < 0 || nz >= n) continue;
      const nk = key3(nx, ny, nz);
      if (this.walls.has(nk) || this.searchClosed.has(nk)) continue;
      const ng = g + 1;
      if (ng < (this.dist.get(nk) ?? Infinity)) {
        this.dist.set(nk, ng);
        this.cameFrom.set(nk, ck);
        this.heap.push(nk, ng + this.heuristic(nx, ny, nz));
        this.searchOpen.add(nk);
      }
    }
    return true;
  }

  private reconstructPath(endKey: string) {
    let cur: string | undefined = endKey;
    while (cur) {
      this.searchPath.add(cur);
      cur = this.cameFrom.get(cur);
    }
  }

  // ---------- Цикл / обновление ----------
  private tick(now: number) {
    if (this.searchRunning) {
      if (!this.searchLastTime) this.searchLastTime = now;
      const dt = Math.min(0.1, (now - this.searchLastTime) / 1000);
      this.searchLastTime = now;
      this.searchAccumulator += dt * this.searchSpeed;

      const MAX_STEPS_PER_FRAME = 4000;
      let alive = true;
      let done = 0;
      let changed = false;
      while (
        this.searchAccumulator >= 1 &&
        alive &&
        done < MAX_STEPS_PER_FRAME
      ) {
        alive = this.step();
        this.searchAccumulator -= 1;
        done++;
        changed = true;
      }
      if (changed) {
        this.overlayDirty = true;
        this.emitSearch();
      }
      if (!alive) this.emitSearch();
    }

    if (this.overlayDirty) {
      this.updateOverlay();
      this.overlayDirty = false;
    }
  }

  private updateLayer(mesh: THREE.InstancedMesh | null, keys: Set<string>, exclude?: Set<string>) {
    if (!mesh) return;
    let i = 0;
    for (const k of keys) {
      if (exclude && exclude.has(k)) continue;
      const [x, y, z] = k.split(",").map(Number);
      this.dummy.position.copy(this.worldPos(x, y, z));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateOverlay() {
    // closed без клеток пути (как в 2D), open поверх, path — ярко.
    this.updateLayer(this.closedMesh, this.searchClosed, this.searchPath);
    this.updateLayer(this.openMesh, this.searchOpen, this.searchPath);
    this.updateLayer(this.pathMesh, this.searchPath);
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

  dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.orbit?.dispose();
    this.orbit = null;
    this.disposeMesh(this.wallMesh);
    this.disposeMesh(this.closedMesh);
    this.disposeMesh(this.openMesh);
    this.disposeMesh(this.pathMesh);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.container = null;
  }
}
