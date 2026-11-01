import type { AuditBundle, Config, Outcome, State, Treasury } from '../agent-work/contracts.js';

/** One immutable fictional ledger identity per local database. No real account identity. */
export interface Binding {
  tenantId: string; merchantId: string; simulationId: string; configHash: string;
  mode: 'OFFLINE_SIMULATION'; unit: 'FAKE_CREDIT';
}
export interface Checkpoint { storageVersion: number; auditHead: string }
export interface StoredAudit { checkpoint: Checkpoint; bundle: AuditBundle }
export interface CommitResult<T> { checkpoint: Checkpoint; value: T }
/** Implementations commit the returned bundle atomically before returning a result. */
export interface AtomicAuditStore {
  readonly binding: Readonly<Binding>;
  transact<T>(operation: (current: StoredAudit) => Promise<{ bundle: AuditBundle; value: T }>): Promise<CommitResult<T>>;
  close(): Promise<void>;
}
export interface LedgerView {
  mode: 'OFFLINE_SIMULATION'; binding: Binding; checkpoint: Checkpoint;
  state: State; treasury: Treasury; identity: Config['agent'];
}
export interface DurableOutcome { checkpoint: Checkpoint; outcome: Outcome }
/** Capabilities are issued by trusted local composition, never selected by command JSON. */
export interface CommandPort {
  readonly tenantId: string; readonly actorId: string;
  readonly kind: 'agent' | 'customer' | 'operator' | 'fake-rail';
  submit(command: unknown): Promise<DurableOutcome>;
}
export interface FakeObservationAdapter extends CommandPort {
  readonly kind: 'fake-rail'; readonly source: 'FAKE_ADAPTER'; readonly networkEnabled: false;
}
export class LedgerError extends Error {
  constructor(readonly code: string) { super(code); }
}
