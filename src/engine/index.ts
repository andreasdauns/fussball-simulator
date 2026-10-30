/**
 * Öffentliche Schnittstelle der Simulations-Engine.
 */

export * from './types';
export { createRng, hashString, type Rng } from './rng';
export { ENGINE_VERSION } from './version';
export { simulateMatch, isRestartType, type SimulateOptions } from './match';
