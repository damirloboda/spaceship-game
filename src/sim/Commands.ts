/**
 * Команды игрока. Ввод никогда не меняет мир напрямую: он ставит команду
 * в очередь, а симуляция применяет её в начале тика. Это делает мир
 * воспроизводимым (seed + журнал команд) и позволяет в будущем вынести
 * симуляцию в отдельный поток/на сервер без изменения интерфейса.
 */
export type Command =
  | { type: 'route'; points: number[][] }
  | { type: 'removeRoute'; id: number }
  | { type: 'dig'; cells: number[][] }
  | { type: 'build'; cells: number[][] }
  | { type: 'reinforce'; cells: number[][] }
  | { type: 'forbid'; cells: number[][]; on: boolean }
  | { type: 'markFood'; x: number; y: number }
  | { type: 'attack'; x: number; y: number }
  | { type: 'explore'; x: number; y: number }
  | { type: 'priority'; task: number; level: number }
  | { type: 'cancelBlueprint'; id: number }
  | { type: 'spawnFood'; kind: number; x: number; y: number; mass: number }
  | { type: 'spawnAnts'; n: number }
  | { type: 'spawnCreature'; kind: number; x: number; y: number }
  | { type: 'paint'; cells: number[][]; mat: number }
  | { type: 'water'; x: number; y: number }
  | { type: 'weather'; kind: number };
