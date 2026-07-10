import type { GridEditor, Tool } from "./grid";

export interface TutorialCallbacks {
  /** Сгенерировать небольшую демонстрационную карту. */
  onGenerateMap: () => void;
  /** Выставить скорость поиска (верш/сек) на слайдере. */
  onSetSpeed: (verticesPerSecond: number) => void;
  /** Запустить визуализацию A*. */
  onRunSearch: () => void;
}

interface Step {
  title: string;
  text: string;
  /** Элемент, который нужно подсветить (спотлайт). */
  target?: () => Element | null;
  /** Действие при показе шага. */
  onEnter?: () => void;
  /** Действие при нажатии основной кнопки (до перехода дальше). */
  onNext?: () => void;
  /** Подпись основной кнопки. */
  nextLabel?: string;
}

const STORAGE_KEY = "astar_tutorial_done";

/**
 * Пошаговое покнопочное обучение (онбординг).
 * Затемняет интерфейс, подсвечивает нужный элемент и ведёт пользователя
 * по сценарию: рассказ о сайте → поле → виды клеток → генерация карты →
 * скорость → запуск A*.
 */
export class Tutorial {
  private root: HTMLDivElement | null = null;
  private spot!: HTMLDivElement;
  private card!: HTMLDivElement;
  private index = 0;
  private steps: Step[];
  private onResize = () => this.layout();

  constructor(
    private editor: GridEditor,
    private cb: TutorialCallbacks
  ) {
    this.steps = this.buildSteps();
  }

  private q(sel: string): Element | null {
    return document.querySelector(sel);
  }

  private activateSwatch(tool: Tool) {
    const palette = this.q("#palette");
    palette
      ?.querySelectorAll(".swatch")
      .forEach((s) => s.classList.remove("active"));
    palette?.querySelector(`.swatch[data-tool="${tool}"]`)?.classList.add(
      "active"
    );
    this.editor.setTool(tool);
    this.q("#board")?.classList.remove("pan-mode");
  }

  private buildSteps(): Step[] {
    return [
      {
        title: "Привет! Это визуализатор A*",
        text: "Здесь можно рисовать карту с препятствиями и наблюдать, как алгоритм A* ищет кратчайший путь от старта до финиша. Пройдём короткое обучение — это займёт минуту.",
        nextLabel: "Поехали",
      },
      {
        title: "Игровое поле",
        text: "Это бесконечная сетка. По ней можно перемещаться (перетаскивание правой кнопкой мыши, Shift или двумя пальцами) и приближать/отдалять колёсиком или щипком.",
        target: () => this.q("#board"),
      },
      {
        title: "Старт (A)",
        text: "Синим цветом на этой палитре ставится точка старта — откуда алгоритм начинает поиск. Старт всегда один.",
        target: () => this.q('.swatch[data-tool="start"]'),
        onEnter: () => this.activateSwatch("start"),
      },
      {
        title: "Финиш (B)",
        text: "Красным ставится финиш — куда нужно проложить путь. Тоже только один.",
        target: () => this.q('.swatch[data-tool="end"]'),
        onEnter: () => this.activateSwatch("end"),
      },
      {
        title: "Стены",
        text: "Чёрным рисуются стены — препятствия, которые нельзя пройти. Зажми кнопку и веди мышью, чтобы рисовать сразу несколько клеток.",
        target: () => this.q('.swatch[data-tool="wall"]'),
        onEnter: () => this.activateSwatch("wall"),
      },
      {
        title: "Ластик",
        text: "Ластик стирает клетку обратно в пустую. Повторный клик по активному цвету выключает рисование и включает перетаскивание карты.",
        target: () => this.q('.swatch[data-tool="erase"]'),
        onEnter: () => this.activateSwatch("erase"),
      },
      {
        title: "Небольшая случайная карта",
        text: "Сгенерируем маленькую карту 15×15 со случайными стенами, стартом и финишем в противоположных углах — чтобы было на чём запустить поиск.",
        target: () => this.q("#board"),
        onEnter: () => {
          this.activateSwatch("wall");
          this.cb.onGenerateMap();
        },
      },
      {
        title: "Скорость поиска",
        text: "Этим ползунком выбирается, сколько вершин алгоритм обрабатывает в секунду — от 0.1 до 1000. Поставим небольшую скорость, чтобы разглядеть, как распространяется волна поиска.",
        target: () => this.q(".speed-row"),
        onEnter: () => this.cb.onSetSpeed(5),
      },
      {
        title: "Запускаем A*!",
        text: "Готово. Жми кнопку — алгоритм начнёт искать путь на выбранной скорости. Бирюзовый — фронтир (что предстоит проверить), сиреневый — уже проверенные клетки, жёлтый — найденный путь.",
        target: () => this.q("#btn-search"),
        nextLabel: "Запустить A*",
        onNext: () => this.cb.onRunSearch(),
      },
    ];
  }

  start() {
    this.index = 0;
    if (!this.root) this.build();
    this.root!.style.display = "block";
    window.addEventListener("resize", this.onResize);
    this.show();
  }

  private build() {
    const root = document.createElement("div");
    root.className = "tut-root";
    root.innerHTML = /* html */ `
      <div class="tut-spot"></div>
      <div class="tut-card">
        <h3 class="tut-title"></h3>
        <p class="tut-text"></p>
        <div class="tut-actions">
          <button class="tut-btn tut-skip" type="button">Пропустить</button>
          <span class="tut-progress"></span>
          <div class="tut-nav">
            <button class="tut-btn tut-back" type="button">Назад</button>
            <button class="tut-btn tut-next" type="button">Далее</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.spot = root.querySelector(".tut-spot")!;
    this.card = root.querySelector(".tut-card")!;

    root.querySelector(".tut-skip")!.addEventListener("click", () =>
      this.finish()
    );
    root.querySelector(".tut-back")!.addEventListener("click", () =>
      this.prev()
    );
    root.querySelector(".tut-next")!.addEventListener("click", () =>
      this.next()
    );
  }

  private show() {
    const step = this.steps[this.index];
    step.onEnter?.();

    this.card.querySelector(".tut-title")!.textContent = step.title;
    this.card.querySelector(".tut-text")!.textContent = step.text;
    this.card.querySelector(".tut-progress")!.textContent = `${
      this.index + 1
    } / ${this.steps.length}`;

    const backBtn = this.card.querySelector<HTMLButtonElement>(".tut-back")!;
    backBtn.style.visibility = this.index === 0 ? "hidden" : "visible";

    const nextBtn = this.card.querySelector<HTMLButtonElement>(".tut-next")!;
    nextBtn.textContent =
      step.nextLabel ??
      (this.index === this.steps.length - 1 ? "Готово" : "Далее");

    // Небольшая задержка, чтобы сгенерированная карта успела отрисоваться
    // и getBoundingClientRect вернул актуальные размеры.
    requestAnimationFrame(() => this.layout());
  }

  private layout() {
    if (!this.root) return;
    const step = this.steps[this.index];
    const target = step.target?.() ?? null;
    const pad = 8;

    if (target) {
      const r = target.getBoundingClientRect();
      this.spot.style.display = "block";
      this.spot.style.left = `${r.left - pad}px`;
      this.spot.style.top = `${r.top - pad}px`;
      this.spot.style.width = `${r.width + pad * 2}px`;
      this.spot.style.height = `${r.height + pad * 2}px`;
      this.positionCard(r);
    } else {
      // Нет цели — затемняем весь экран, карточку ставим по центру.
      this.spot.style.display = "block";
      this.spot.style.left = `50%`;
      this.spot.style.top = `50%`;
      this.spot.style.width = `0px`;
      this.spot.style.height = `0px`;
      this.positionCard(null);
    }
  }

  private positionCard(rect: DOMRect | null) {
    const card = this.card;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 18;
    const margin = 12;

    if (!rect) {
      card.style.left = `${(vw - cw) / 2}px`;
      card.style.top = `${(vh - ch) / 2}px`;
      return;
    }

    // Пытаемся разместить снизу, иначе сверху, иначе по центру экрана.
    let top: number;
    if (rect.bottom + gap + ch <= vh - margin) {
      top = rect.bottom + gap;
    } else if (rect.top - gap - ch >= margin) {
      top = rect.top - gap - ch;
    } else {
      top = (vh - ch) / 2;
    }

    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(margin, Math.min(left, vw - cw - margin));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  private next() {
    const step = this.steps[this.index];
    step.onNext?.();
    if (this.index >= this.steps.length - 1) {
      this.finish();
      return;
    }
    this.index++;
    this.show();
  }

  private prev() {
    if (this.index === 0) return;
    this.index--;
    this.show();
  }

  private finish() {
    localStorage.setItem(STORAGE_KEY, "1");
    window.removeEventListener("resize", this.onResize);
    if (this.root) this.root.style.display = "none";
  }
}
