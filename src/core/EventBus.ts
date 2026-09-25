/**
 * Шина игровых событий. Системы не знают друг о друге напрямую:
 * симуляция публикует факты ("обвал", "мост построен"), а аудио, UI, камера и память колонии на них подписаны.
 */
export type GameEvent =
  | { type: 'collapse'; x: number; y: number; size: number }
  | { type: 'dig'; x: number; y: number; mat: number }
  | { type: 'build'; x: number; y: number }
  | { type: 'foodFound'; x: number; y: number; kind: number; mass: number; colony: number }
  | { type: 'foodDelivered'; amount: number; colony: number }
  | { type: 'structureComplete'; id: number; kind: number; ants: number; x: number; y: number }
  | { type: 'structureDissolved'; id: number }
  | { type: 'antDied'; x: number; y: number; colony: number; cause: number }
  | { type: 'creatureDied'; x: number; y: number; kind: number }
  | { type: 'threat'; x: number; y: number; kind: number; level: number }
  | { type: 'flood'; x: number; y: number; roomId: number }
  | { type: 'levelUp'; level: number }
  | { type: 'roomPlanned'; roomType: number; x: number; y: number }
  | { type: 'roomComplete'; roomType: number; x: number; y: number }
  | { type: 'hatch'; count: number }
  | { type: 'weather'; kind: number }
  | { type: 'treeFell'; x: number; y: number }
  | { type: 'notice'; text: string; x?: number; y?: number; tone?: 'info' | 'good' | 'bad' };

type Handler = (e: GameEvent) => void;

export class EventBus {
  private handlers: Handler[] = [];
  private queue: GameEvent[] = [];

  on(h: Handler): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }

  /** События копятся в очереди и раздаются один раз за тик — симуляция не зависит от подписчиков. */
  emit(e: GameEvent): void {
    this.queue.push(e);
  }

  flush(): void {
    if (this.queue.length === 0) return;
    const q = this.queue;
    this.queue = [];
    for (const e of q) for (const h of this.handlers) h(e);
  }
}
