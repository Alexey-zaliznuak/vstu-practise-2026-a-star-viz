import type { CityNode, Edge } from "./graph";

export interface AStarResult {
  path: string[] | null;
  cost: number;
}

/**
 * Евклидова эвристика, масштабированная минимальным множителем веса `hScale`.
 * Магистрали «дешевле» своей длины (вес = длина × majorFactor), поэтому
 * минимальная стоимость единицы длины равна majorFactor. Чтобы эвристика
 * оставалась допустимой (не переоценивала остаток пути), её нужно умножить
 * на этот же коэффициент — иначе A* может вернуть неоптимальный маршрут.
 */
export function heuristic(a: CityNode, b: CityNode, hScale = 1): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * hScale;
}

/**
 * Пошаговый A* по взвешенному графу — удобно для покадровой визуализации.
 * Один вызов step() обрабатывает одну вершину (извлечение минимума из open set).
 */
export class AStarRunner {
  readonly open = new Set<string>();
  readonly closed = new Set<string>();
  readonly cameFrom = new Map<string, string>();
  readonly gScore = new Map<string, number>();
  readonly fScore = new Map<string, number>();

  /** Вершина, обработанная на последнем шаге (для подсветки «текущей»). */
  current: string | null = null;
  finished = false;
  found = false;
  path: string[] | null = null;

  constructor(
    private graph: Map<string, Edge[]>,
    private nodes: Map<string, CityNode>,
    startId: string,
    private goalId: string,
    /** Множитель эвристики для сохранения допустимости (обычно = majorFactor). */
    private hScale = 1
  ) {
    this.gScore.set(startId, 0);
    this.fScore.set(
      startId,
      heuristic(nodes.get(startId)!, nodes.get(goalId)!, hScale)
    );
    this.open.add(startId);
  }

  /** Обработать одну вершину. Возвращает true, пока поиск продолжается. */
  step(): boolean {
    if (this.finished) return false;

    if (this.open.size === 0) {
      this.finished = true;
      this.found = false;
      return false;
    }

    // Вершина из open с минимальным f.
    let current: string | null = null;
    let best = Infinity;
    for (const node of this.open) {
      const f = this.fScore.get(node) ?? Infinity;
      if (f < best) {
        best = f;
        current = node;
      }
    }
    if (current === null) {
      this.finished = true;
      return false;
    }

    this.current = current;

    if (current === this.goalId) {
      this.path = reconstruct(this.cameFrom, current);
      this.finished = true;
      this.found = true;
      return false;
    }

    this.open.delete(current);
    this.closed.add(current);

    const g = this.gScore.get(current) ?? Infinity;
    for (const edge of this.graph.get(current) ?? []) {
      if (this.closed.has(edge.to)) continue;
      const tentative = g + edge.weight;
      if (tentative < (this.gScore.get(edge.to) ?? Infinity)) {
        this.cameFrom.set(edge.to, current);
        this.gScore.set(edge.to, tentative);
        this.fScore.set(
          edge.to,
          tentative +
            heuristic(this.nodes.get(edge.to)!, this.nodes.get(this.goalId)!, this.hScale)
        );
        this.open.add(edge.to);
      }
    }
    return true;
  }

  /** Длина найденного пути в единицах веса (пикселях мировых координат). */
  get pathCost(): number {
    if (!this.path) return 0;
    return this.gScore.get(this.goalId) ?? 0;
  }
}

function reconstruct(cameFrom: Map<string, string>, current: string): string[] {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.push(current);
  }
  return path.reverse();
}

/** Синхронный A* без анимации (например, для случайного выбора точек с проверкой пути). */
export function astar(
  graph: Map<string, Edge[]>,
  nodes: Map<string, CityNode>,
  startId: string,
  goalId: string,
  hScale = 1
): AStarResult {
  const runner = new AStarRunner(graph, nodes, startId, goalId, hScale);
  while (runner.step()) {
    /* крутим до завершения */
  }
  return { path: runner.path, cost: runner.pathCost };
}
