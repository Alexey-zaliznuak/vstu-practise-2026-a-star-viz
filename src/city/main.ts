import "../style.css";
import { CityMap, type CityStats, type CitySearchState, type CitySelection } from "./map";
import { CITY_DEFAULTS, type CityOptions } from "./graph";

const SPEED_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const fmtSpeed = (v: number) => String(v);

window.addEventListener("error", (e) =>
  console.error("[city] необработанная ошибка:", e.message, e.error)
);

// ---- Описание параметров генератора (слайдеры настроек) ----
interface ParamDef {
  key: keyof typeof CITY_DEFAULTS;
  label: string;
  min: number;
  max: number;
  step: number;
  /** UI-значение → значение опции (например, % → доля). */
  toOption: (v: number) => number;
  fmt: (v: number) => string;
}

const pct = (v: number) => `${v}%`;
const PARAMS: ParamDef[] = [
  { key: "mapSizeKm", label: "Размер карты", min: 2, max: 100, step: 0.5, toOption: (v) => v, fmt: (v) => `${v} × ${v} км` },
  { key: "rings", label: "Кольцевые магистрали", min: 1, max: 10, step: 1, toOption: (v) => v, fmt: String },
  { key: "spokes", label: "Радиальные проспекты", min: 6, max: 20, step: 1, toOption: (v) => v, fmt: String },
  { key: "ringWobble", label: "Кривизна колец", min: 0, max: 100, step: 5, toOption: (v) => v / 100, fmt: pct },
  { key: "blockSize", label: "Размер квартала", min: 90, max: 320, step: 10, toOption: (v) => v, fmt: (v) => `${v} м` },
  { key: "rivers", label: "Реки", min: 0, max: 3, step: 1, toOption: (v) => v, fmt: String },
  { key: "riverSinuosity", label: "Извилистость рек", min: 0, max: 100, step: 5, toOption: (v) => v / 100, fmt: pct },
  { key: "riverWidth", label: "Ширина реки", min: 60, max: 400, step: 20, toOption: (v) => v, fmt: (v) => `${v} м` },
  { key: "bridgeInterval", label: "Интервал мостов", min: 300, max: 1600, step: 50, toOption: (v) => v, fmt: (v) => `~${v} м` },
  { key: "railLines", label: "ЖД-направления", min: 0, max: 6, step: 1, toOption: (v) => v, fmt: String },
  { key: "airports", label: "Аэропорты", min: 0, max: 2, step: 1, toOption: (v) => v, fmt: String },
  { key: "parkShare", label: "Парки", min: 0, max: 40, step: 2, toOption: (v) => v / 100, fmt: pct },
  { key: "lakeShare", label: "Озёра", min: 0, max: 30, step: 1, toOption: (v) => v / 100, fmt: pct },
  { key: "factoryShare", label: "Заводы", min: 0, max: 40, step: 2, toOption: (v) => v / 100, fmt: pct },
  { key: "dropProbability", label: "Обрывы улиц (тупики)", min: 0, max: 40, step: 5, toOption: (v) => v / 100, fmt: pct },
];

/** UI-значение по умолчанию (обратное преобразование из CITY_DEFAULTS). */
const defaultUiValue = (p: ParamDef): number => {
  const opt = CITY_DEFAULTS[p.key];
  // доли хранятся как 0..1, в UI — проценты
  return p.toOption(100) === 1 ? Math.round(opt * 100) : opt;
};

const paramRowsHtml = PARAMS.map(
  (p) => /* html */ `
    <div class="speed-row">
      <label class="speed-label" for="par-${p.key}">
        ${p.label}
        <span class="value" id="par-${p.key}-val"></span>
      </label>
      <input type="range" id="par-${p.key}" class="slider"
        min="${p.min}" max="${p.max}" step="${p.step}" value="${defaultUiValue(p)}" />
    </div>`
).join("");

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = /* html */ `
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">◎</div>
      <div>
        <h1>A* по городу</h1>
        <p>процедурный город в духе Москвы</p>
      </div>
    </div>

    <section class="card">
      <h2>Маршрут</h2>
      <p class="hint" id="sel-hint" style="margin-bottom: 12px">
        Кликай по перекрёсткам, чтобы задать <b>A</b> и <b>B</b>. По умолчанию — случайные.
      </p>
      <div class="stat-row">
        <span class="label"><span class="dot" style="background:#38c172"></span> Точка A (старт)</span>
        <span class="value" id="stat-start">—</span>
      </div>
      <div class="stat-row">
        <span class="label"><span class="dot" style="background:#f0524b"></span> Точка B (финиш)</span>
        <span class="value" id="stat-end">—</span>
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
        <span class="label">Стоимость пути</span>
        <span class="value" id="stat-cost">—</span>
      </div>
    </section>

    <section class="card">
      <h2>Поиск пути (A*, евклид)</h2>
      <div class="speed-row">
        <label class="speed-label" for="speed">
          Скорость
          <span class="value" id="speed-val">200 в/с</span>
        </label>
        <input type="range" id="speed" class="slider" min="0" max="10" step="1" value="7" />
      </div>
      <div class="btn-col">
        <button class="btn primary" id="btn-search">Запустить A*</button>
        <button class="btn text" id="btn-clear-search">Сбросить поиск</button>
      </div>
      <p class="hint" id="search-status" style="margin-top: 10px"></p>
    </section>

    <section class="card">
      <h2>Карта</h2>
      <div class="btn-col">
        <button class="btn primary" id="btn-regen">Новый город</button>
        <button class="btn tonal" id="btn-random-points">Случайные A и B</button>
        <button class="btn tonal" id="btn-reset-view">Центрировать карту</button>
        <button class="btn text" id="btn-clear-points">Сбросить точки</button>
      </div>
    </section>

    <section class="card">
      <h2>Генератор</h2>
      <details class="settings" open>
        <summary>Параметры города</summary>
        ${paramRowsHtml}
        <div class="speed-row">
          <label class="speed-label" for="seed-input">Сид (пусто — случайный)</label>
          <input type="text" id="seed-input" class="text-input" inputmode="numeric"
            placeholder="например, 123456789" />
        </div>
        <div class="btn-col">
          <button class="btn tonal" id="btn-apply">Перегенерировать с параметрами</button>
          <button class="btn text" id="btn-defaults">Сбросить параметры</button>
        </div>
      </details>
    </section>

    <section class="card">
      <h2>Статистика графа</h2>
      <div class="stat-row">
        <span class="label">Перекрёстков</span>
        <span class="value" id="stat-nodes">0</span>
      </div>
      <div class="stat-row">
        <span class="label">Дорог (рёбер)</span>
        <span class="value" id="stat-edges">0</span>
      </div>
      <div class="stat-row">
        <span class="label">Сид карты</span>
        <span class="value" id="stat-seed" title="Вставь в поле «Сид», чтобы повторить карту">—</span>
      </div>
      <div class="stat-row">
        <span class="label">Масштаб</span>
        <span class="value" id="stat-scale">100%</span>
      </div>
      <a class="btn text" href="../" style="text-align:center; text-decoration:none; margin-top:6px">← Редактор-сетка</a>
    </section>
  </aside>

  <main class="board board-city pan-mode" id="board">
    <canvas id="city"></canvas>
    <div class="coords" id="coords">кликни по перекрёстку</div>
  </main>
`;

// ---- Слайдеры параметров ----
const paramInputs = new Map<string, HTMLInputElement>();
for (const p of PARAMS) {
  const input = document.querySelector<HTMLInputElement>(`#par-${p.key}`)!;
  const val = document.querySelector<HTMLSpanElement>(`#par-${p.key}-val`)!;
  const update = () => (val.textContent = p.fmt(Number(input.value)));
  input.addEventListener("input", update);
  update();
  paramInputs.set(p.key, input);
}

const seedInput = document.querySelector<HTMLInputElement>("#seed-input")!;

/** Собрать опции генератора из текущего состояния слайдеров. */
const collectOptions = (): CityOptions => {
  const opts: CityOptions = {};
  for (const p of PARAMS) {
    (opts as Record<string, number>)[p.key] = p.toOption(Number(paramInputs.get(p.key)!.value));
  }
  const seedRaw = seedInput.value.trim();
  if (seedRaw !== "" && Number.isFinite(Number(seedRaw))) opts.seed = Number(seedRaw);
  return opts;
};

const canvas = document.querySelector<HTMLCanvasElement>("#city")!;
const city = new CityMap(canvas, collectOptions());

const el = {
  start: document.querySelector<HTMLSpanElement>("#stat-start")!,
  end: document.querySelector<HTMLSpanElement>("#stat-end")!,
  open: document.querySelector<HTMLSpanElement>("#stat-open")!,
  closed: document.querySelector<HTMLSpanElement>("#stat-closed")!,
  path: document.querySelector<HTMLSpanElement>("#stat-path")!,
  cost: document.querySelector<HTMLSpanElement>("#stat-cost")!,
  nodes: document.querySelector<HTMLSpanElement>("#stat-nodes")!,
  edges: document.querySelector<HTMLSpanElement>("#stat-edges")!,
  seed: document.querySelector<HTMLSpanElement>("#stat-seed")!,
  scale: document.querySelector<HTMLSpanElement>("#stat-scale")!,
  coords: document.querySelector<HTMLDivElement>("#coords")!,
  selHint: document.querySelector<HTMLParagraphElement>("#sel-hint")!,
  searchStatus: document.querySelector<HTMLParagraphElement>("#search-status")!,
};

city.onStats = (s: CityStats) => {
  el.nodes.textContent = String(s.nodes);
  el.edges.textContent = String(s.edges);
  el.seed.textContent = String(s.seed);
  el.scale.textContent = `${s.scalePercent}%`;
  el.coords.textContent = s.hoverId
    ? `перекрёсток ${s.hoverId}`
    : "кликни по перекрёстку";
};

city.onSelection = (s: CitySelection) => {
  el.start.textContent = s.start ?? "—";
  el.end.textContent = s.goal ?? "—";
  if (!s.start) {
    el.selHint.innerHTML = "Кликни по перекрёстку — поставим <b>A</b> (старт).";
  } else if (!s.goal) {
    el.selHint.innerHTML = "Теперь кликни ещё раз — поставим <b>B</b> (финиш).";
  } else {
    el.selHint.innerHTML = "Готово! Жми «Запустить A*». Клик по карте начнёт заново.";
  }
};

city.onSearch = (s: CitySearchState) => {
  el.open.textContent = String(s.open);
  el.closed.textContent = String(s.closed);
  el.path.textContent = s.pathNodes > 0 ? `${s.pathNodes} перекр.` : "—";
  el.cost.textContent = s.pathCost > 0 ? `${(s.pathCost / 1000).toFixed(2)} км` : "—";
  if (s.running) {
    el.searchStatus.textContent = "Идёт поиск…";
  } else if (s.finished && s.found) {
    el.searchStatus.textContent = `Путь найден: ${s.pathNodes} перекрёстков, просмотрено ${s.closed}.`;
  } else if (s.finished && !s.found) {
    el.searchStatus.textContent = "Путь не найден (точки в разных кусках сети).";
  } else {
    el.searchStatus.textContent = "";
  }
};

// ---- Кнопки ----
document
  .querySelector<HTMLButtonElement>("#btn-search")!
  .addEventListener("click", () => {
    const res = city.startSearch();
    if (!res.ok) el.searchStatus.textContent = res.reason ?? "Не удалось запустить поиск";
  });

document
  .querySelector<HTMLButtonElement>("#btn-clear-search")!
  .addEventListener("click", () => city.clearSearch());

// «Новый город» — всегда новый случайный сид; «Перегенерировать» — учитывает поле сида.
document
  .querySelector<HTMLButtonElement>("#btn-regen")!
  .addEventListener("click", () => {
    seedInput.value = "";
    city.regenerate(collectOptions(), true);
  });

document
  .querySelector<HTMLButtonElement>("#btn-apply")!
  .addEventListener("click", () => city.regenerate(collectOptions(), true));

document
  .querySelector<HTMLButtonElement>("#btn-defaults")!
  .addEventListener("click", () => {
    for (const p of PARAMS) {
      const input = paramInputs.get(p.key)!;
      input.value = String(defaultUiValue(p));
      input.dispatchEvent(new Event("input"));
    }
    seedInput.value = "";
  });

document
  .querySelector<HTMLButtonElement>("#btn-random-points")!
  .addEventListener("click", () => city.randomizePoints());

document
  .querySelector<HTMLButtonElement>("#btn-reset-view")!
  .addEventListener("click", () => city.resetView());

document
  .querySelector<HTMLButtonElement>("#btn-clear-points")!
  .addEventListener("click", () => city.clearSelection());

// ---- Слайдер скорости ----
const speedInput = document.querySelector<HTMLInputElement>("#speed")!;
const speedVal = document.querySelector<HTMLSpanElement>("#speed-val")!;
const applySpeed = (idx: number) => {
  const v = SPEED_STEPS[idx] ?? 200;
  city.setSpeed(v);
  speedVal.textContent = `${fmtSpeed(v)} в/с`;
};
speedInput.addEventListener("input", () => applySpeed(Number(speedInput.value)));
applySpeed(Number(speedInput.value));
