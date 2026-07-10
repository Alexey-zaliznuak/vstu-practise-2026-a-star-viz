import "./style.css";
import {
  GridEditor,
  type Tool,
  type GridStats,
  type SearchState,
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
        <input type="range" id="speed" min="0" max="12" step="1" value="8" />
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
        <button class="btn tonal" id="btn-random">Случайная карта</button>
        <button class="btn tonal" id="btn-reset-view">Центрировать поле</button>
        <button class="btn text" id="btn-tutorial">Обучение</button>
        <button class="btn text" id="btn-export">Экспорт карты (JSON)</button>
        <button class="btn text" id="btn-clear">Очистить всё</button>
      </div>
    </section>
  </aside>

  <main class="board" id="board">
    <div class="palette" id="palette">
      <button class="swatch" data-tool="start" style="--c: #2196f3" title="Старт (синий)"></button>
      <button class="swatch" data-tool="erase" title="Ластик (белый)"></button>
      <button class="swatch" data-tool="end" style="--c: #f44336" title="Финиш (красный)"></button>
      <button class="swatch active" data-tool="wall" style="--c: #212121" title="Стена (чёрный)"></button>
    </div>
    <canvas id="grid"></canvas>
    <div class="coords" id="coords">—</div>
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

document
  .querySelector<HTMLButtonElement>("#btn-random")!
  .addEventListener("click", () => editor.generateRandom());

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
