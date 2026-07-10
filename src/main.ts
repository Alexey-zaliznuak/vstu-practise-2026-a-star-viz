import "./style.css";
import {
  GridEditor,
  type Tool,
  type GridStats,
  type SearchState,
  type CellTooltip,
} from "./grid";
import { Tutorial } from "./tutorial";

/** Дискретные шаги скорости поиска: вершин в секунду. */
const SPEED_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
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
        <button class="btn text" id="btn-export">Экспорт карты (JSON)</button>
        <button class="btn text" id="btn-clear">Очистить всё</button>
      </div>
    </section>
  </aside>

  <div class="modal-overlay" id="modal-random" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-random-title">
      <h2 id="modal-random-title">Настройки случайной карты</h2>
      <div class="speed-row">
        <label class="speed-label" for="rand-size">
          Размер поля
          <span class="value" id="rand-size-val">101 × 101</span>
        </label>
        <input type="range" id="rand-size" class="slider" min="5" max="201" step="2" value="101" />
      </div>
      <p class="hint">Карта будет квадратом size × size клеток. Старт и финиш ставятся в противоположных углах.</p>
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

// Размер случайной карты (сторона квадрата в клетках).
let randomSize = 101;
document
  .querySelector<HTMLButtonElement>("#btn-random")!
  .addEventListener("click", () => editor.generateRandom(0.28, randomSize));

// ---- Модалка настроек случайной карты ----
const randModal = document.querySelector<HTMLDivElement>("#modal-random")!;
const randSizeInput = document.querySelector<HTMLInputElement>("#rand-size")!;
const randSizeVal = document.querySelector<HTMLSpanElement>("#rand-size-val")!;

const updateRandSize = () => {
  randomSize = Number(randSizeInput.value);
  randSizeVal.textContent = `${randomSize} × ${randomSize}`;
};
randSizeInput.addEventListener("input", updateRandSize);
updateRandSize();

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
    editor.generateRandom(0.28, randomSize);
    closeRandModal();
  });
// Клик по затемнению вне карточки — закрыть.
randModal.addEventListener("click", (e) => {
  if (e.target === randModal) closeRandModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !randModal.hasAttribute("hidden")) closeRandModal();
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

const applySpeed = (idx: number) => {
  const v = SPEED_STEPS[idx] ?? 50;
  editor.setSpeed(v);
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
