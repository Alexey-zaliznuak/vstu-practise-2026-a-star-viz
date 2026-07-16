import "./style.css";
import {
  GridEditor,
  type Tool,
  type GridStats,
  type SearchState,
  type CellTooltip,
} from "./grid";
import { Tutorial } from "./tutorial";
import { Grid3DViewer, type Search3DState } from "./grid3d";

/** Дискретные шаги скорости поиска: вершин в секунду. */
const SPEED_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const fmtSpeed = (v: number) => (v < 1 ? v.toString() : String(v));

window.addEventListener("error", (e) =>
  console.error("[global] необработанная ошибка:", e.message, e.error)
);
console.log("[main] скрипт загружен");

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = /* html */ `
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">★</div>
      <div>
        <h1>A* — редактор карты</h1>
        <p>рисуй поле для алгоритма поиска пути</p>
      </div>
    </div>

    <section class="card">
      <h2>Легенда</h2>
      <div class="stat-row">
        <span class="label"><span class="dot start"></span> Старт (A)</span>
        <span class="value" id="stat-start">—</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot end"></span> Финиш (B)</span>
        <span class="value" id="stat-end">—</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot wall"></span> Стены</span>
        <span class="value" id="stat-walls">0</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot open"></span> Фронтир (open set)</span>
        <span class="value" id="stat-open">0</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot closed"></span> Пройдено (closed set)</span>
        <span class="value" id="stat-closed">0</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot path"></span> Длина пути</span>
        <span class="value" id="stat-path">—</span>
      </div>
      <div class="stat-row">
        <span class="label">Масштаб клетки</span>
        <span class="value" id="stat-zoom">40&nbsp;px</span>
      </div>
    </section>

    <section class="card">
      <h2>Поиск пути (A*, манхэттен)</h2>
      <div class="speed-row">
        <label class="speed-label" for="speed">
          Скорость
          <span class="value" id="speed-val">50 в/с</span>
        </label>
        <input type="range" id="speed" class="slider" min="0" max="12" step="1" value="8" />
      </div>
      <div class="btn-col">
        <button class="btn primary" id="btn-search">Запустить A*</button>
        <button class="btn text" id="btn-clear-search">Сбросить поиск</button>
      </div>
      <p class="hint" id="search-status" style="margin-top: 10px"></p>
    </section>

    <section class="card">
      <h2>Действия</h2>
      <div class="btn-col">
        <button class="btn tonal" id="btn-maze">Сгенерировать лабиринт</button>
        <div class="btn-row">
          <button class="btn tonal grow" id="btn-random">Случайная карта</button>
          <button class="btn tonal icon-btn" id="btn-random-settings" title="Настройки случайной карты" aria-label="Настройки случайной карты">⚙</button>
        </div>
        <button class="btn tonal" id="btn-reset-view">Центрировать поле</button>
        <button class="btn text" id="btn-tutorial">Обучение</button>
        <button class="btn text" id="btn-clear">Очистить всё</button>
        <a class="btn tonal" href="city/" style="text-align:center; text-decoration:none">Город (A* по графу) →</a>
      </div>
    </section>
  </aside>

  <div class="modal-overlay" id="modal-random" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-random-title">
      <h2 id="modal-random-title">Настройки случайной карты</h2>
      <div class="dim-row">
        <span class="speed-label">Размерность</span>
        <div class="dim-toggle" role="radiogroup" aria-label="Размерность карты">
          <button type="button" class="dim-btn active" data-dim="2" role="radio" aria-checked="true">2D</button>
          <button type="button" class="dim-btn" data-dim="3" role="radio" aria-checked="false">3D</button>
        </div>
      </div>
      <div class="speed-row">
        <label class="speed-label" for="rand-size">
          Размер поля
          <span class="value" id="rand-size-val">101 × 101</span>
        </label>
        <input type="range" id="rand-size" class="slider" min="5" max="201" step="2" value="101" />
      </div>
      <p class="hint" id="rand-hint">Карта будет квадратом size × size клеток. Старт и финиш ставятся в противоположных углах.</p>
      <div class="btn-row" style="margin-top: 16px">
        <button class="btn primary grow" id="rand-apply">Сгенерировать</button>
        <button class="btn text" id="rand-close">Закрыть</button>
      </div>
    </div>
  </div>

  <main class="board" id="board">
    <div class="palette" id="palette">
      <button class="swatch" data-tool="start" style="--c: #2196f3" title="Старт (синий)"></button>
      <button class="swatch" data-tool="erase" title="Ластик (белый)"></button>
      <button class="swatch" data-tool="end" style="--c: #f44336" title="Финиш (красный)"></button>
      <button class="swatch active" data-tool="wall" style="--c: #212121" title="Стена (чёрный)"></button>
    </div>
    <canvas id="grid"></canvas>
    <div class="coords" id="coords">—</div>
    <div class="cell-tip" id="cell-tip" hidden></div>

    <div class="board-3d" id="board-3d" hidden>
      <div class="panel-3d">
        <div class="panel-3d-title">3D-режим (A*, 6 направлений)</div>
        <div class="btn-row">
          <button class="btn primary grow" id="btn-3d-search">Запустить A*</button>
          <button class="btn tonal" id="btn-3d-regen">Новая карта</button>
        </div>
        <button class="btn text" id="btn-3d-back">← Назад к 2D</button>
        <p class="hint">Крути мышью — вращение, колесо — зум. Синий куб — старт, красный — финиш.</p>
      </div>
    </div>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>("#grid")!;
const editor = new GridEditor(canvas);
editor.setTool("wall");

const board = document.querySelector<HTMLDivElement>("#board")!;

// ---- Палитра-«светофор» ----
const palette = document.querySelector<HTMLDivElement>("#palette")!;
palette.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".swatch");
  if (!btn) return;

  // Повторный клик по активному цвету — снять выбор (режим перетаскивания карты)
  if (btn.classList.contains("active")) {
    btn.classList.remove("active");
    editor.setTool(null);
    board.classList.add("pan-mode");
    return;
  }

  palette
    .querySelectorAll(".swatch")
    .forEach((s) => s.classList.remove("active"));
  btn.classList.add("active");
  editor.setTool(btn.dataset.tool as Tool);
  board.classList.remove("pan-mode");
});

// ---- Статистика в сайдбаре ----
const el = {
  start: document.querySelector<HTMLSpanElement>("#stat-start")!,
  end: document.querySelector<HTMLSpanElement>("#stat-end")!,
  walls: document.querySelector<HTMLSpanElement>("#stat-walls")!,
  open: document.querySelector<HTMLSpanElement>("#stat-open")!,
  closed: document.querySelector<HTMLSpanElement>("#stat-closed")!,
  path: document.querySelector<HTMLSpanElement>("#stat-path")!,
  zoom: document.querySelector<HTMLSpanElement>("#stat-zoom")!,
  coords: document.querySelector<HTMLDivElement>("#coords")!,
  searchStatus: document.querySelector<HTMLParagraphElement>("#search-status")!,
};

editor.onStats = (s: GridStats) => {
  el.start.textContent = s.start ? `${s.start.x}, ${s.start.y}` : "—";
  el.end.textContent = s.end ? `${s.end.x}, ${s.end.y}` : "—";
  el.walls.textContent = String(s.walls);
  el.zoom.innerHTML = `${s.cellSize}&nbsp;px`;
  el.coords.textContent = s.hover
    ? `клетка: ${s.hover.x}, ${s.hover.y}`
    : "наведи курсор на поле";
};

editor.onSearch = (s: SearchState) => {
  el.open.textContent = String(s.open);
  el.closed.textContent = String(s.closed);
  el.path.textContent = s.pathLength > 0 ? String(s.pathLength) : "—";
  if (s.running) {
    el.searchStatus.textContent = "Идёт поиск…";
  } else if (s.finished && s.found) {
    el.searchStatus.textContent = `Путь найден: ${s.pathLength} клеток, просмотрено ${s.closed}.`;
  } else if (s.finished && !s.found) {
    el.searchStatus.textContent =
      "Путь не найден в зоне поиска (возможно, финиш замурован или слишком далеко).";
  } else {
    el.searchStatus.textContent = "";
  }
};

editor.onPanState = (panning) => board.classList.toggle("panning", panning);

// ---- Подсказка по клетке (появляется при наведении с задержкой) ----
const cellTip = document.querySelector<HTMLDivElement>("#cell-tip")!;
editor.onCellTooltip = (info: CellTooltip | null) => {
  if (!info) {
    cellTip.setAttribute("hidden", "");
    return;
  }
  const f = info.g + info.h;
  cellTip.innerHTML = /* html */ `
    <div class="cell-tip-row"><b>${info.g}</b> — уже найденный минимальный путь от старта до этой клетки (g)</div>
    <div class="cell-tip-row"><b>${info.h}</b> — эвристика: оценка оставшегося расстояния до финиша (h, манхэттен)</div>
    <div class="cell-tip-row muted">f = g + h = ${f} — приоритет клетки в очереди A*</div>
  `;
  cellTip.removeAttribute("hidden");
  // Позиционируем рядом с курсором и прижимаем к границам доски.
  const bw = board.clientWidth;
  const bh = board.clientHeight;
  const tw = cellTip.offsetWidth;
  const th = cellTip.offsetHeight;
  let left = info.px + 16;
  let top = info.py + 16;
  if (left + tw > bw - 8) left = info.px - tw - 16;
  if (top + th > bh - 8) top = info.py - th - 16;
  left = Math.max(8, left);
  top = Math.max(8, top);
  cellTip.style.left = `${left}px`;
  cellTip.style.top = `${top}px`;
};

// ---- Кнопки ----
document
  .querySelector<HTMLButtonElement>("#btn-search")!
  .addEventListener("click", () => {
    const res = editor.startSearch();
    if (!res.ok) el.searchStatus.textContent = res.reason ?? "Не удалось запустить поиск";
  });

document
  .querySelector<HTMLButtonElement>("#btn-clear-search")!
  .addEventListener("click", () => editor.clearSearch());

document
  .querySelector<HTMLButtonElement>("#btn-maze")!
  .addEventListener("click", () => editor.generateMaze());

// ---- Настройки случайной карты: размерность и размер ----
// Отдельные значения размера для 2D и 3D (объём в 3D растёт кубически).
const DIM_CFG = {
  2: { min: 5, max: 201, step: 2, def: 101 },
  3: { min: 5, max: 40, step: 1, def: 15 },
} as const;
let currentDim: 2 | 3 = 2;
let randomSize2d: number = DIM_CFG[2].def;
let randomSize3d: number = DIM_CFG[3].def;

const randModal = document.querySelector<HTMLDivElement>("#modal-random")!;
const randSizeInput = document.querySelector<HTMLInputElement>("#rand-size")!;
const randSizeVal = document.querySelector<HTMLSpanElement>("#rand-size-val")!;
const randHint = document.querySelector<HTMLParagraphElement>("#rand-hint")!;
const dimBtns = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".dim-btn")
);

const currentSize = () => (currentDim === 2 ? randomSize2d : randomSize3d);

const renderRandSizeLabel = () => {
  const n = currentSize();
  randSizeVal.textContent =
    currentDim === 2 ? `${n} × ${n}` : `${n} × ${n} × ${n}`;
};

// Перенастраивает слайдер под выбранную размерность и обновляет подписи.
const applyDimUI = () => {
  const cfg = DIM_CFG[currentDim];
  randSizeInput.min = String(cfg.min);
  randSizeInput.max = String(cfg.max);
  randSizeInput.step = String(cfg.step);
  randSizeInput.value = String(currentSize());
  randHint.textContent =
    currentDim === 2
      ? "Карта будет квадратом size × size клеток. Старт и финиш ставятся в противоположных углах."
      : "Карта будет кубом size × size × size ячеек. A* ищет путь по 6 направлениям, старт и финиш — в противоположных углах.";
  dimBtns.forEach((b) => {
    const active = Number(b.dataset.dim) === currentDim;
    b.classList.toggle("active", active);
    b.setAttribute("aria-checked", String(active));
  });
  renderRandSizeLabel();
};

randSizeInput.addEventListener("input", () => {
  const n = Number(randSizeInput.value);
  if (currentDim === 2) randomSize2d = n;
  else randomSize3d = n;
  renderRandSizeLabel();
});

dimBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    currentDim = Number(btn.dataset.dim) === 3 ? 3 : 2;
    applyDimUI();
  })
);
applyDimUI();

// Единая точка генерации: учитывает выбранную размерность.
const generateMap = () => {
  if (currentDim === 3) {
    activate3D();
    viewer!.generateRandom(0.28, randomSize3d);
  } else {
    deactivate3D();
    editor.generateRandom(0.28, randomSize2d);
  }
};

document
  .querySelector<HTMLButtonElement>("#btn-random")!
  .addEventListener("click", generateMap);

const openRandModal = () => randModal.removeAttribute("hidden");
const closeRandModal = () => randModal.setAttribute("hidden", "");

document
  .querySelector<HTMLButtonElement>("#btn-random-settings")!
  .addEventListener("click", openRandModal);
document
  .querySelector<HTMLButtonElement>("#rand-close")!
  .addEventListener("click", closeRandModal);
document
  .querySelector<HTMLButtonElement>("#rand-apply")!
  .addEventListener("click", () => {
    generateMap();
    closeRandModal();
  });
// Клик по затемнению вне карточки — закрыть.
randModal.addEventListener("click", (e) => {
  if (e.target === randModal) closeRandModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !randModal.hasAttribute("hidden")) closeRandModal();
});

// ---- 3D-режим ----
const board3d = document.querySelector<HTMLDivElement>("#board-3d")!;
const palette2d = document.querySelector<HTMLDivElement>("#palette")!;
const coords2d = document.querySelector<HTMLDivElement>("#coords")!;
let viewer: Grid3DViewer | null = null;

const update3dSearchStatus = (s: Search3DState) => {
  el.open.textContent = String(s.open);
  el.closed.textContent = String(s.closed);
  el.path.textContent = s.pathLength > 0 ? String(s.pathLength) : "—";
  if (s.running) {
    el.searchStatus.textContent = "Идёт поиск в 3D…";
  } else if (s.finished && s.found) {
    el.searchStatus.textContent = `Путь найден: ${s.pathLength} ячеек, просмотрено ${s.closed}.`;
  } else if (s.finished && !s.found) {
    el.searchStatus.textContent = "Путь не найден (финиш недостижим).";
  } else {
    el.searchStatus.textContent = "";
  }
};

// Показывает 3D-вьювер поверх доски и (лениво) создаёт его.
function activate3D() {
  if (!viewer) {
    viewer = new Grid3DViewer();
    viewer.onSearch = update3dSearchStatus;
    const host = board3d.querySelector<HTMLDivElement>(".panel-3d")!;
    viewer.mount(board3d);
    // canvas three.js кладём перед панелью, чтобы панель осталась поверх
    board3d.insertBefore(board3d.lastChild!, host);
    viewer.setSpeed(currentSpeed);
  }
  editor.clearSearch(false);
  board3d.removeAttribute("hidden");
  canvas.style.display = "none";
  palette2d.style.display = "none";
  coords2d.style.display = "none";
  viewer.resize();
}

// Возвращает 2D-режим и освобождает ресурсы three.js.
function deactivate3D() {
  board3d.setAttribute("hidden", "");
  canvas.style.display = "";
  palette2d.style.display = "";
  coords2d.style.display = "";
  if (viewer) {
    viewer.dispose();
    viewer = null;
  }
}

document
  .querySelector<HTMLButtonElement>("#btn-3d-search")!
  .addEventListener("click", () => {
    const res = viewer?.startSearch();
    if (res && !res.ok)
      el.searchStatus.textContent = res.reason ?? "Не удалось запустить поиск";
  });
document
  .querySelector<HTMLButtonElement>("#btn-3d-regen")!
  .addEventListener("click", () => viewer?.generateRandom(0.28, randomSize3d));
document
  .querySelector<HTMLButtonElement>("#btn-3d-back")!
  .addEventListener("click", () => {
    currentDim = 2;
    applyDimUI();
    deactivate3D();
  });

document
  .querySelector<HTMLButtonElement>("#btn-reset-view")!
  .addEventListener("click", () => editor.resetView());

document
  .querySelector<HTMLButtonElement>("#btn-clear")!
  .addEventListener("click", () => editor.clearAll());

// ---- Слайдер скорости ----
const speedInput = document.querySelector<HTMLInputElement>("#speed")!;
const speedVal = document.querySelector<HTMLSpanElement>("#speed-val")!;

let currentSpeed = 50;
const applySpeed = (idx: number) => {
  const v = SPEED_STEPS[idx] ?? 50;
  currentSpeed = v;
  editor.setSpeed(v);
  viewer?.setSpeed(v);
  speedVal.textContent = `${fmtSpeed(v)} в/с`;
};
speedInput.addEventListener("input", () =>
  applySpeed(Number(speedInput.value))
);
applySpeed(Number(speedInput.value));

/** Программно выставить скорость по значению (верш/сек) — для обучения. */
const setSpeedByValue = (value: number) => {
  const idx = SPEED_STEPS.indexOf(value);
  if (idx < 0) return;
  speedInput.value = String(idx);
  applySpeed(idx);
};

// ---- Обучение ----
console.log("[tutorial] создаём экземпляр Tutorial");
const tutorial = new Tutorial(editor, {
  onGenerateMap: () => editor.generateRandom(0.28, 15, true),
  onSetSpeed: setSpeedByValue,
  onRunSearch: () => {
    const res = editor.startSearch();
    if (!res.ok)
      el.searchStatus.textContent = res.reason ?? "Не удалось запустить поиск";
  },
});

document
  .querySelector<HTMLButtonElement>("#btn-tutorial")!
  .addEventListener("click", () => tutorial.start());

// Первый визит — запускаем обучение автоматически.
const tutorialDone = localStorage.getItem("astar_tutorial_done");
console.log("[tutorial] флаг astar_tutorial_done =", tutorialDone);
if (!tutorialDone) {
  console.log("[tutorial] первый визит — запускаем обучение");
  tutorial.start();
} else {
  console.log("[tutorial] обучение уже пройдено, авто-старт пропущен");
}

document
  .querySelector<HTMLButtonElement>("#btn-export")!
  .addEventListener("click", () => {
    const data = editor.exportMap();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "map.json";
    a.click();
    URL.revokeObjectURL(url);
  });
