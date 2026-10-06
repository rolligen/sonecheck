/**
 * Core Facade — the only entry the UI layer may import (`02` §1 Facade discipline).
 *
 * Exposes the risk engine, the pure helpers and the shared core types; internal
 * implementations stay private.
 */

export { contextBudgetBytes, buildContext } from './contextBuilder';
export { normalizeConfig } from './config';
export { filterRisky } from './threshold';
export { createRiskEngine } from './riskEngine';

export type { RawConfigInput, SoneCheckConfig } from './config';
export type { RiskItem, ScoredHunk } from './threshold';
export type { InspectionReport, RiskEngine, RiskEngineDeps } from './riskEngine';
