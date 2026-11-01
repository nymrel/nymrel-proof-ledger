/** Tenant-bound orchestration around the unchanged reviewed R3 engine. No server. */
import { canonicalHash, canonicalize } from '../../src/core/canonical.js';
import { Simulation } from '../agent-work/engine.js';
import type { AuditBundle, Config, Principal } from '../agent-work/contracts.js';
import type { AtomicAuditStore, CommandPort, DurableOutcome, FakeObservationAdapter, LedgerView } from './contracts.js';
import { LedgerError } from './contracts.js';

export class DurableLedger {
  readonly #store: AtomicAuditStore;
  readonly #config: Config;
  readonly worker: CommandPort;
  readonly operator: CommandPort;
  readonly fakeObservations: FakeObservationAdapter;

  constructor(store: AtomicAuditStore, config: Config) {
    this.#config = JSON.parse(canonicalize(config)) as Config;
    new Simulation(this.#config);
    if (store.binding.configHash !== canonicalHash(this.#config) || store.binding.tenantId !== this.#config.accountableEntity.tenantId || store.binding.merchantId !== this.#config.accountableEntity.merchantId || store.binding.mode !== 'OFFLINE_SIMULATION' || store.binding.unit !== 'FAKE_CREDIT') throw new LedgerError('TENANT_OR_CONFIG_MISMATCH');
    this.#store = store;
    this.worker = this.#port({ kind: 'agent', id: this.#config.agent.id });
    this.operator = this.#port({ kind: 'operator', id: 'fixtureOperator' });
    this.fakeObservations = Object.freeze({ ...this.#port({ kind: 'fake-rail', id: 'fixtureRail' }), kind: 'fake-rail', source: 'FAKE_ADAPTER', networkEnabled: false });
  }

  customer(customerId: string): CommandPort {
    if (!this.#config.scopes.some(s => s.customerId === customerId) || customerId === this.#config.agent.id) throw new LedgerError('UNKNOWN_CUSTOMER');
    return this.#port({ kind: 'customer', id: customerId });
  }

  #port(principal: Principal): CommandPort {
    return Object.freeze({ tenantId: this.#store.binding.tenantId, actorId: principal.id, kind: principal.kind,
      submit: (command: unknown) => this.#submit(principal, command) });
  }

  #submit(principal: Principal, input: unknown): Promise<DurableOutcome> {
    let command: unknown;
    try {
      const serialized = canonicalize(input);
      if (Buffer.byteLength(serialized, 'utf8') > 32768) throw new Error('size');
      command = JSON.parse(serialized) as unknown;
    } catch { return Promise.reject(new LedgerError('COMMAND_JSON_BOUNDARY')); }
    return this.#store.transact(async current => {
      const sim = await Simulation.restore(current.bundle, current.checkpoint.auditHead);
      const outcome = principal.kind === 'agent' ? await sim.agent(command)
        : principal.kind === 'operator' ? await sim.operator(command)
        : principal.kind === 'fake-rail' ? await sim.fakeRail(command)
        : await sim.customer(principal.id)(command);
      return { bundle: sim.exportAudit(), value: outcome };
    }).then(result => ({ checkpoint: result.checkpoint, outcome: result.value }));
  }

  view(): Promise<LedgerView> {
    return this.#store.transact(async current => {
      const sim = await Simulation.restore(current.bundle, current.checkpoint.auditHead);
      return { bundle: current.bundle, value: { mode: 'OFFLINE_SIMULATION' as const,
        binding: { ...this.#store.binding }, checkpoint: current.checkpoint,
        state: sim.snapshot(), treasury: sim.balance(), identity: sim.identity() } };
    }).then(result => result.value);
  }

  exportAudit(): Promise<AuditBundle> {
    return this.#store.transact(async current => {
      await Simulation.restore(current.bundle, current.checkpoint.auditHead);
      return { bundle: current.bundle, value: current.bundle };
    }).then(result => result.value);
  }

  close(): Promise<void> { return this.#store.close(); }
}
