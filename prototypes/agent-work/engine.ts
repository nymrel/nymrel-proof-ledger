/** Offline deterministic simulation. In-process role ports are not authentication. */
import { canonicalHash, canonicalize } from '../../src/core/canonical.js';
import { MerkleTree } from '../../src/core/merkle.js';
import { hashArtifact } from '../../src/core/receipt.js';
import type { CheckpointSource } from '../../src/profiles/checkpoint.js';
import { releasePacket } from './work-adapter.js';
import type {
  AgentCommand, AuditBundle, AuditRecord, Command, Config, CustomerCommand,
  Invoice, Observation, OperatorCommand, Outcome, Principal, RailCommand,
  State, Treasury, Work,
} from './contracts.js';

const MAX_RECORDS = 2048;
const MAX_CREDITS = 1_000_000_000;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string): v is Obj => obj(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const credits = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= MAX_CREDITS;
const text = (v: unknown, max = 8192): v is string => typeof v === 'string' && v.trim().length > 0 && Buffer.byteLength(v, 'utf8') <= max;
const own = <T>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
const copy = <T>(value: T): T => JSON.parse(canonicalize(value)) as T;
class Refusal extends Error { constructor(readonly code: string) { super(code); } }
function requireThat(value: unknown, code: string): asserts value { if (!value) throw new Refusal(code); }

function validateConfig(v: unknown): asserts v is Config {
  requireThat(exact(v, 'schema simulationId accountableEntity accounting agent openingCredits reserve spendBudget scopes catalog'), 'CONFIG_SHAPE');
  requireThat(v.schema === 'nymrel.agent-work.config/0.1' && id(v.simulationId), 'CONFIG_VERSION');
  requireThat(exact(v.accountableEntity, 'tenantId merchantId displayName status') && id(v.accountableEntity.tenantId) && id(v.accountableEntity.merchantId) && text(v.accountableEntity.displayName, 256) && v.accountableEntity.status === 'FICTIONAL', 'FICTIONAL_ENTITY_REQUIRED');
  requireThat(exact(v.accounting, 'unit minorUnitExponent') && v.accounting.unit === 'FAKE_CREDIT' && v.accounting.minorUnitExponent === 0, 'FAKE_UNIT_REQUIRED');
  requireThat(exact(v.agent, 'id disclosure requestedModel observedModel') && id(v.agent.id) && v.agent.disclosure === 'I am a software agent in an offline simulation.' && text(v.agent.requestedModel, 128) && (v.agent.observedModel === null || text(v.agent.observedModel, 128)), 'AGENT_IDENTITY');
  requireThat(credits(v.openingCredits) && credits(v.reserve) && credits(v.spendBudget) && v.reserve <= v.openingCredits, 'CONFIG_AMOUNTS');
  requireThat(Array.isArray(v.scopes) && v.scopes.length <= 128 && Array.isArray(v.catalog) && v.catalog.length <= 128, 'CONFIG_CAPACITY');
  const scopes = new Map<string, Config['scopes'][number]>();
  for (const s of v.scopes) {
    requireThat(exact(s, 'id customerId kind maxCost maxReward') && id(s.id) && id(s.customerId) && s.customerId !== v.agent.id && s.kind === 'release_check_packet' && credits(s.maxCost) && credits(s.maxReward, 1) && !scopes.has(s.id), 'CONFIG_SCOPE');
    scopes.set(s.id, s as unknown as Config['scopes'][number]);
  }
  const seen = new Set<string>();
  for (const w of v.catalog) {
    requireThat(exact(w, 'id scopeId title description kind reward costCeiling unit deadlineTick criteriaRevision observedAt pages manifest') && id(w.id) && w.id.length <= 48 && id(w.scopeId) && text(w.title, 256) && text(w.description) && w.kind === 'release_check_packet' && credits(w.reward, 1) && credits(w.costCeiling) && w.unit === 'FAKE_CREDIT' && credits(w.deadlineTick, 1) && id(w.criteriaRevision) && text(w.observedAt, 64) && scopes.has(w.scopeId) && !seen.has(w.id), 'CONFIG_LISTING');
    requireThat(Array.isArray(w.pages) && Array.isArray(w.manifest) && w.pages.length <= 10 && w.manifest.length >= 1 && w.manifest.length <= 10, 'PAGE_LIMIT');
    for (const [rows, linksKey] of [[w.pages, 'links'], [w.manifest, 'requiredLinks']] as const) {
      const pageIds = new Set<string>();
      for (const page of rows) {
        requireThat(exact(page, `pageId status title canonical ${linksKey}`) && id(page.pageId) && !pageIds.has(page.pageId) && credits(page.status, 100) && page.status <= 599 && text(page.title, 256) && text(page.canonical, 256) && Array.isArray(page[linksKey]) && (page[linksKey] as unknown[]).length <= 32 && (page[linksKey] as unknown[]).every(link => text(link, 256)), 'PAGE_SHAPE');
        pageIds.add(page.pageId);
      }
    }
    seen.add(w.id);
  }
}

const SHAPES: Record<Command['type'], string> = {
  discover_work: 'workId', scope_assignment: 'workId', accept_assignment: 'workId', begin_work: 'workId', deliver_artifact: 'workId content',
  issue_invoice: 'workId', cancel_work: 'workId', close_commitment: 'workId',
  begin_spend: 'workId attemptId amount', begin_refund: 'invoiceId attemptId',
  accept_delivery: 'workId artifactSha256 scopeDigest criteriaRevision', reject_delivery: 'workId reason',
  request_refund: 'invoiceId amount reason', revoke_scope: 'scopeId',
  observe_earning: 'invoiceId paymentId observation', observe_spend: 'attemptId observation',
  observe_refund: 'attemptId observation',
  advance_clock: 'tick', expire_work: 'workId', dispute_invoice: 'invoiceId reason', resolve_dispute: 'invoiceId',
};
const LANES: Record<Command['type'], Principal['kind']> = {
  discover_work: 'agent', scope_assignment: 'agent', accept_assignment: 'agent', begin_work: 'agent', deliver_artifact: 'agent', issue_invoice: 'agent',
  cancel_work: 'agent', close_commitment: 'agent', begin_spend: 'agent', begin_refund: 'agent',
  accept_delivery: 'customer', reject_delivery: 'customer', request_refund: 'customer',
  revoke_scope: 'operator', observe_earning: 'fake-rail', observe_spend: 'fake-rail', observe_refund: 'fake-rail',
  advance_clock: 'operator', expire_work: 'operator', dispute_invoice: 'customer', resolve_dispute: 'customer',
};
function validateCommand(v: unknown): asserts v is Command {
  requireThat(obj(v) && typeof v.type === 'string' && Object.hasOwn(SHAPES, v.type), 'UNKNOWN_COMMAND');
  const shape = SHAPES[v.type as Command['type']];
  requireThat(exact(v, `type requestId ${shape}${Object.hasOwn(v, 'expectedRevision') ? ' expectedRevision' : ''}`), 'COMMAND_SHAPE');
  requireThat(id(v.requestId), 'REQUEST_ID');
  if (Object.hasOwn(v, 'expectedRevision')) requireThat(credits(v.expectedRevision), 'REVISION');
  for (const field of shape.split(' ')) {
    const value = v[field];
    if (field.endsWith('Id') || field === 'criteriaRevision') requireThat(id(value), 'IDENTIFIER');
    if (field === 'tick') requireThat(credits(value), 'TICK');
    if (field === 'amount') requireThat(credits(value, 1), 'AMOUNT');
    if (field === 'content' || field === 'reason') requireThat(text(value), 'TEXT');
    if (field === 'artifactSha256' || field === 'scopeDigest') requireThat(typeof value === 'string' && SHA256.test(value), 'ARTIFACT_DIGEST');
    if (field === 'observation') {
      requireThat(exact(value, 'receiptId source sequence amount unit status') && id(value.receiptId) && value.source === 'FAKE_ADAPTER' && credits(value.sequence, 1) && credits(value.amount, 1) && value.unit === 'FAKE_CREDIT' && ['PENDING','UNKNOWN','SETTLED','FAILED'].includes(String(value.status)), 'OBSERVATION');
    }
  }
}

export function treasury(config: Config, state: State): Treasury {
  const sum = <T>(values: T[], f: (v: T) => number): number => values.reduce((n, v) => n + f(v), 0);
  const payments = Object.values(state.payments);
  const commitments = sum(Object.values(state.works), w => w.commitment?.held ?? 0);
  const obligations = sum(Object.values(state.obligations), o => o.status === 'SETTLED' ? 0 : o.amount);
  const disputeReserves = sum(Object.values(state.invoices), i => i.dispute === null ? 0 : Math.max(0, i.settledAmount - (own(state.obligations, i.id)?.amount ?? 0)));
  const available = config.openingCredits + state.settledEarnings - state.settledSpend - state.settledRefunds - config.reserve - commitments - obligations - disputeReserves;
  return {
    unit: 'FAKE_CREDIT', opening: config.openingCredits, settledEarnings: state.settledEarnings,
    pendingEarnings: sum(payments, i => i.status === 'PENDING' ? i.amount : 0),
    uncertainEarnings: sum(payments, i => i.status === 'UNKNOWN' ? i.amount : 0),
    settledSpend: state.settledSpend, settledRefunds: state.settledRefunds, reserve: config.reserve,
    commitments, obligations, disputeReserves, available, spendable: Math.max(0, available), shortfall: Math.max(0, -available),
    discretionaryBudgetRemaining: config.spendBudget - state.settledSpend - commitments,
  };
}

/** The composition root owns these role capabilities. Never hand them all to a model. */
export class Simulation {
  private readonly config: Config;
  private state: State = {
    revision: 0, tick: 0, revokedScopes: [], works: {}, invoices: {}, attempts: {}, obligations: {}, payments: {}, receipts: {},
    settledEarnings: 0, settledSpend: 0, settledRefunds: 0,
  };
  private records: AuditRecord[] = [];
  private readonly requests = new Map<string, { digest: string; outcome: Outcome }>();
  private tail: Promise<void> = Promise.resolve();
  private readonly genesis: string;

  constructor(config: Config) {
    const snapshot = copy(config);
    validateConfig(snapshot);
    this.config = snapshot;
    this.genesis = canonicalHash({ schema: 'nymrel.agent-work.genesis/0.1', config: snapshot });
  }

  agent(command: AgentCommand | unknown): Promise<Outcome> {
    return this.submit({ kind: 'agent', id: this.config.agent.id }, command);
  }
  customer(customerId: string): (command: CustomerCommand | unknown) => Promise<Outcome> {
    requireThat(this.config.scopes.some(s => s.customerId === customerId), 'UNKNOWN_CUSTOMER');
    return command => this.submit({ kind: 'customer', id: customerId }, command);
  }
  operator(command: OperatorCommand | unknown): Promise<Outcome> {
    return this.submit({ kind: 'operator', id: 'fixtureOperator' }, command);
  }
  fakeRail(command: RailCommand | unknown): Promise<Outcome> {
    return this.submit({ kind: 'fake-rail', id: 'fixtureRail' }, command);
  }
  snapshot(): State { return copy(this.state); }
  balance(): Treasury { return treasury(this.config, this.state); }
  identity(): Config['agent'] { return copy(this.config.agent); }
  private head(): string { return this.records.at(-1)?.hash ?? this.genesis; }

  private submit(principal: Principal, input: unknown): Promise<Outcome> {
    // Snapshot before queueing: later caller mutations cannot change the admitted command.
    let command: unknown;
    try {
      const serialized = canonicalize(input);
      if (Buffer.byteLength(serialized, 'utf8') > 32_768) throw new Error('size');
      command = JSON.parse(serialized) as unknown;
    } catch {
      return Promise.resolve({ ok: false, code: 'JSON_BOUNDARY', revision: this.state.revision, replayed: false, data: {} });
    }
    const pending = this.tail.then(() => this.transact(principal, command));
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async transact(principal: Principal, input: unknown): Promise<Outcome> {
    const requestKey = obj(input) && id(input.requestId) ? `${principal.kind}:${principal.id}:${input.requestId}` : null;
    const digest = canonicalHash(input);
    const previous = requestKey === null ? undefined : this.requests.get(requestKey);
    if (previous?.digest === digest) return { ...copy(previous.outcome), replayed: true };
    if (this.records.length >= MAX_RECORDS) return { ok: false, code: 'AUDIT_CAPACITY', revision: this.state.revision, replayed: false, data: {} };
    let outcome: Outcome;
    try {
      requireThat(previous === undefined, 'IDEMPOTENCY_CONFLICT');
      validateCommand(input);
      requireThat(LANES[input.type] === principal.kind, 'ROLE_DENIED');
      requireThat(input.expectedRevision === undefined || input.expectedRevision === this.state.revision, 'STALE_REVISION');
      const next = copy(this.state);
      const data = await this.apply(next, principal, input);
      const balances = treasury(this.config, next);
      requireThat(Object.values(balances).filter(v => typeof v === 'number').every(Number.isSafeInteger), 'ARITHMETIC_RANGE');
      requireThat(balances.commitments >= 0 && balances.obligations >= 0 && balances.discretionaryBudgetRemaining >= 0, 'ACCOUNTING_INVARIANT');
      next.revision++;
      this.state = next;
      outcome = { ok: true, code: 'APPLIED', revision: next.revision, replayed: false, data };
    } catch (error) {
      // Unexpected failures leave the working copy uncommitted and surface to the caller.
      if (!(error instanceof Refusal)) throw error;
      outcome = { ok: false, code: error.code, revision: this.state.revision, replayed: false, data: {} };
    }
    const body = {
      sequence: this.records.length, previousHash: this.head(), principal: copy(principal), command: input,
      outcome, stateHash: canonicalHash(this.state),
    };
    this.records.push({ ...body, hash: canonicalHash(body) });
    if (requestKey !== null && previous === undefined) this.requests.set(requestKey, { digest, outcome: copy(outcome) });
    return copy(outcome);
  }

  private work(s: State, workId: string): Work {
    const work = own(s.works, workId);
    requireThat(work, 'WORK_NOT_FOUND');
    return work;
  }
  private invoice(s: State, invoiceId: string): Invoice {
    const invoice = own(s.invoices, invoiceId);
    requireThat(invoice, 'INVOICE_NOT_FOUND');
    return invoice;
  }
  private active(s: State, work: Work): void {
    requireThat(!s.revokedScopes.includes(work.listing.scopeId), 'SCOPE_REVOKED');
  }
  private notExpired(s: State, work: Work): void {
    requireThat(s.tick < work.listing.deadlineTick, 'ASSIGNMENT_EXPIRED');
  }
  private inFlight(s: State, workId: string): number {
    return Object.values(s.attempts).filter(a => a.kind === 'SPEND' && a.targetId === workId && !['SETTLED','FAILED'].includes(a.status)).reduce((n, a) => n + a.amount, 0);
  }
  private close(s: State, workId: string): void {
    const w = this.work(s, workId);
    requireThat(w.commitment, 'NO_COMMITMENT');
    w.commitment.held = this.inFlight(s, workId);
    w.commitment.closed = true;
  }
  private duplicate(s: State, command: RailCommand): boolean {
    const previous = own(s.receipts, command.observation.receiptId);
    const { requestId: _requestId, expectedRevision: _expectedRevision, ...semantic } = command;
    const digest = canonicalHash(semantic);
    requireThat(previous === undefined || previous === digest, 'RECEIPT_CONFLICT');
    return previous !== undefined;
  }
  private remember(s: State, command: RailCommand): void {
    const { requestId: _requestId, expectedRevision: _expectedRevision, ...semantic } = command;
    s.receipts[command.observation.receiptId] = canonicalHash(semantic);
  }
  private ordered(current: { sequence: number; status: string }, receipt: Observation): void {
    requireThat(!['SETTLED','FAILED'].includes(current.status), 'TERMINAL_OBSERVATION');
    requireThat(receipt.sequence === current.sequence + 1, 'RECEIPT_OUT_OF_ORDER');
  }

  private async apply(s: State, principal: Principal, c: Command): Promise<Record<string, unknown>> {
    switch (c.type) {
      case 'discover_work': {
        requireThat(!own(s.works, c.workId), 'WORK_EXISTS');
        const listing = this.config.catalog.find(w => w.id === c.workId);
        requireThat(listing, 'LISTING_NOT_FOUND');
        const scope = this.config.scopes.find(a => a.id === listing.scopeId)!;
        requireThat(!s.revokedScopes.includes(scope.id), 'SCOPE_REVOKED');
        requireThat(scope.kind === listing.kind && listing.reward <= scope.maxReward && listing.costCeiling <= scope.maxCost, 'INELIGIBLE_WORK');
        requireThat(s.tick < listing.deadlineTick, 'ASSIGNMENT_EXPIRED');
        // Check the bounded adapter's output capacity before exposing or reserving an assignment.
        requireThat(text(releasePacket(listing)), 'INELIGIBLE_PACKET_TOO_LARGE');
        s.works[c.workId] = { listing: copy(listing), customerId: scope.customerId, stage: 'DISCOVERED', scopeDigest: null, artifact: null, acceptance: null, execution: null, rejection: null, commitment: null };
        return { listing: copy(listing), descriptionTrust: 'UNTRUSTED_DATA', agentDisclosure: this.config.agent.disclosure };
      }
      case 'scope_assignment': {
        const w = this.work(s, c.workId); this.active(s, w);
        this.notExpired(s, w);
        requireThat(w.stage === 'DISCOVERED', 'WORK_STAGE');
        w.scopeDigest = canonicalHash({ listing: w.listing, scope: this.config.scopes.find(a => a.id === w.listing.scopeId)! });
        w.stage = 'SCOPED';
        return { scopeDigest: w.scopeDigest, criteriaRevision: w.listing.criteriaRevision, deadlineTick: w.listing.deadlineTick, price: w.listing.reward, costCeiling: w.listing.costCeiling, unit: w.listing.unit };
      }
      case 'accept_assignment': {
        const w = this.work(s, c.workId); this.active(s, w); this.notExpired(s, w);
        requireThat(w.stage === 'SCOPED', 'WORK_STAGE');
        const b = treasury(this.config, s);
        requireThat(b.available >= w.listing.costCeiling && b.discretionaryBudgetRemaining >= w.listing.costCeiling, 'INSUFFICIENT_AVAILABLE');
        w.stage = 'AUTHORIZED';
        w.commitment = { held: w.listing.costCeiling, closed: false };
        return { scopeDigest: w.scopeDigest, reserved: w.commitment.held };
      }
      case 'begin_work': {
        const w = this.work(s, c.workId); this.active(s, w); this.notExpired(s, w);
        requireThat(w.stage === 'AUTHORIZED', 'WORK_STAGE');
        const content = releasePacket(w.listing);
        requireThat(text(content), 'PACKET_TOO_LARGE');
        // Existing artifact hashing with supplied bytes only; no filesystem read.
        const artifact = { ...await hashArtifact('delivery.txt', content, '/offline-simulation'), mimeType: 'text/plain' };
        w.stage = 'EXECUTING';
        w.execution = { adapter: 'SAVED_FICTIONAL_PAGES', realCost: null, costKnowledge: 'UNKNOWN', output: { content, artifact } };
        return { execution: w.execution, scopeDigest: w.scopeDigest };
      }
      case 'deliver_artifact': {
        const w = this.work(s, c.workId); this.active(s, w);
        this.notExpired(s, w);
        requireThat(w.stage === 'EXECUTING' && w.execution, 'WORK_STAGE');
        requireThat(c.content === w.execution.output.content, 'DELIVERY_CONTENT_MISMATCH');
        w.artifact = copy(w.execution.output.artifact);
        w.stage = 'DELIVERED';
        return { artifact: w.artifact, acceptance: 'AWAITING_SEPARATE_CUSTOMER' };
      }
      case 'accept_delivery': {
        const w = this.work(s, c.workId);
        requireThat(w.customerId === principal.id, 'CUSTOMER_MISMATCH');
        requireThat(w.stage === 'DELIVERED' && w.artifact, 'WORK_STAGE');
        this.notExpired(s, w);
        requireThat(c.artifactSha256 === w.artifact.sha256, 'DELIVERY_BINDING');
        requireThat(c.scopeDigest === w.scopeDigest && c.criteriaRevision === w.listing.criteriaRevision, 'CRITERIA_BINDING');
        w.acceptance = { customerId: principal.id, artifactSha256: c.artifactSha256, scopeDigest: c.scopeDigest, criteriaRevision: c.criteriaRevision };
        w.stage = 'ACCEPTED'; return { acceptance: w.acceptance, provenance: 'FICTIONAL_CUSTOMER_PORT' };
      }
      case 'reject_delivery': {
        const w = this.work(s, c.workId);
        requireThat(w.customerId === principal.id, 'CUSTOMER_MISMATCH');
        requireThat(w.stage === 'DELIVERED', 'WORK_STAGE');
        w.stage = 'REJECTED'; w.rejection = c.reason; this.close(s, c.workId);
        return { heldForUnresolvedSpend: w.commitment!.held };
      }
      case 'cancel_work': {
        const w = this.work(s, c.workId);
        requireThat(['DISCOVERED','SCOPED','AUTHORIZED','EXECUTING','DELIVERED'].includes(w.stage), 'WORK_STAGE');
        w.stage = 'CANCELLED';
        if (w.commitment) this.close(s, c.workId);
        return { heldForUnresolvedSpend: w.commitment?.held ?? 0 };
      }
      case 'close_commitment': {
        this.close(s, c.workId);
        return { heldForUnresolvedSpend: this.work(s, c.workId).commitment!.held };
      }
      case 'issue_invoice': {
        const w = this.work(s, c.workId); this.active(s, w); this.notExpired(s, w);
        requireThat(w.stage === 'ACCEPTED' && w.artifact && w.acceptance, 'CUSTOMER_ACCEPTANCE_REQUIRED');
        const invoiceId = `invoice_${c.workId}`;
        requireThat(!own(s.invoices, invoiceId), 'INVOICE_EXISTS');
        s.invoices[invoiceId] = { id: invoiceId, workId: c.workId, amount: w.listing.reward, customerId: w.customerId, artifactSha256: w.artifact.sha256, settledAmount: 0, dispute: null, status: 'ISSUED' };
        return { invoiceId, amount: w.listing.reward, unit: 'FAKE_CREDIT' };
      }
      case 'begin_spend': {
        const w = this.work(s, c.workId); this.active(s, w);
        this.notExpired(s, w);
        requireThat(['AUTHORIZED','EXECUTING','DELIVERED','ACCEPTED'].includes(w.stage), 'WORK_STAGE');
        requireThat(!Object.values(s.invoices).some(i => i.workId === c.workId && i.dispute !== null), 'DISPUTED_WORK');
        requireThat(w.commitment && !w.commitment.closed, 'COMMITMENT_CLOSED');
        requireThat(treasury(this.config, s).available >= 0, 'INSUFFICIENT_AVAILABLE');
        requireThat(!own(s.attempts, c.attemptId), 'ATTEMPT_EXISTS');
        requireThat(w.commitment.held - this.inFlight(s, c.workId) >= c.amount, 'RESERVATION_EXCEEDED');
        s.attempts[c.attemptId] = { id: c.attemptId, kind: 'SPEND', targetId: c.workId, amount: c.amount, status: 'REQUESTED', sequence: 0 };
        return { attemptId: c.attemptId, execution: 'FAKE_ADAPTER_ONLY', held: c.amount };
      }
      case 'revoke_scope': {
        requireThat(this.config.scopes.some(a => a.id === c.scopeId), 'SCOPE_NOT_FOUND');
        if (!s.revokedScopes.includes(c.scopeId)) s.revokedScopes.push(c.scopeId);
        return { scopeId: c.scopeId, retainedCommitments: treasury(this.config, s).commitments };
      }
      case 'observe_earning': {
        if (this.duplicate(s, c)) return { receipt: 'DUPLICATE_NO_ACCOUNTING_EFFECT' };
        const i = this.invoice(s, c.invoiceId);
        let p = own(s.payments, c.paymentId);
        if (!p) {
          const committed = Object.values(s.payments).filter(p => p.invoiceId === i.id && p.status !== 'FAILED').reduce((n, p) => n + p.amount, 0);
          requireThat(committed + c.observation.amount <= i.amount, 'PAYMENT_EXCEEDS_INVOICE');
          requireThat(c.observation.sequence === 1, 'RECEIPT_OUT_OF_ORDER');
          p = { id: c.paymentId, invoiceId: i.id, amount: c.observation.amount, sequence: 0, status: 'PENDING' };
          s.payments[p.id] = p;
        }
        requireThat(p.invoiceId === i.id, 'PAYMENT_BINDING');
        requireThat(p.amount === c.observation.amount, 'AMOUNT_BINDING');
        this.ordered(p, c.observation);
        p.sequence = c.observation.sequence; p.status = c.observation.status;
        if (p.status === 'SETTLED') { s.settledEarnings += p.amount; i.settledAmount += p.amount; }
        i.status = i.settledAmount === i.amount ? 'SETTLED' : i.settledAmount > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
        this.remember(s, c);
        return { observedStatus: p.status, invoiceStatus: i.status, source: 'FAKE_ADAPTER', realSettlement: false };
      }
      case 'request_refund': {
        const i = this.invoice(s, c.invoiceId);
        requireThat(i.customerId === principal.id, 'CUSTOMER_MISMATCH');
        requireThat(i.settledAmount > 0, 'SETTLED_EARNING_REQUIRED');
        requireThat(c.amount <= i.settledAmount && !own(s.obligations, i.id), 'REFUND_LIMIT');
        // A liability is recorded even if it reveals a shortfall; new spending then fails.
        s.obligations[i.id] = { invoiceId: i.id, amount: c.amount, reason: c.reason, status: 'OPEN', attemptId: null };
        return { liability: c.amount, unit: 'FAKE_CREDIT' };
      }
      case 'dispute_invoice': {
        const i = this.invoice(s, c.invoiceId);
        requireThat(i.customerId === principal.id, 'CUSTOMER_MISMATCH');
        requireThat(i.dispute === null, 'DISPUTE_EXISTS'); i.dispute = c.reason;
        return { dispute: 'OPEN', accountingEffect: 'SETTLED_AMOUNT_HELD_WITHOUT_DOUBLE_COUNTING_REFUNDS' };
      }
      case 'resolve_dispute': {
        const i = this.invoice(s, c.invoiceId);
        requireThat(i.customerId === principal.id, 'CUSTOMER_MISMATCH');
        requireThat(i.dispute !== null, 'NO_DISPUTE'); i.dispute = null;
        return { dispute: 'RESOLVED_BY_FICTIONAL_CUSTOMER' };
      }
      case 'advance_clock': {
        requireThat(c.tick > s.tick, 'CLOCK_MUST_ADVANCE'); s.tick = c.tick;
        return { tick: s.tick, timeSource: 'FICTIONAL_OPERATOR_TICK' };
      }
      case 'expire_work': {
        const w = this.work(s, c.workId);
        requireThat(s.tick >= w.listing.deadlineTick, 'NOT_EXPIRED');
        requireThat(['DISCOVERED','SCOPED','AUTHORIZED','EXECUTING','DELIVERED'].includes(w.stage), 'WORK_STAGE');
        w.stage = 'EXPIRED'; if (w.commitment) this.close(s, c.workId);
        return { heldForUnresolvedSpend: w.commitment?.held ?? 0 };
      }
      case 'begin_refund': {
        const o = own(s.obligations, c.invoiceId);
        requireThat(o && o.status === 'OPEN', 'OPEN_OBLIGATION_REQUIRED');
        requireThat(treasury(this.config, s).available >= 0, 'REFUND_UNFUNDED');
        requireThat(!own(s.attempts, c.attemptId), 'ATTEMPT_EXISTS');
        s.attempts[c.attemptId] = { id: c.attemptId, kind: 'REFUND', targetId: c.invoiceId, amount: o.amount, status: 'REQUESTED', sequence: 0 };
        o.status = 'IN_FLIGHT'; o.attemptId = c.attemptId;
        return { attemptId: c.attemptId, amount: o.amount, execution: 'FAKE_ADAPTER_ONLY' };
      }
      case 'observe_spend':
      case 'observe_refund': {
        if (this.duplicate(s, c)) return { receipt: 'DUPLICATE_NO_ACCOUNTING_EFFECT' };
        const a = own(s.attempts, c.attemptId);
        requireThat(a && a.kind === (c.type === 'observe_spend' ? 'SPEND' : 'REFUND'), 'ATTEMPT_BINDING');
        requireThat(a.amount === c.observation.amount, 'AMOUNT_BINDING');
        this.ordered(a, c.observation);
        a.sequence = c.observation.sequence; a.status = c.observation.status;
        if (a.kind === 'SPEND') {
          const w = this.work(s, a.targetId);
          requireThat(w.commitment, 'NO_COMMITMENT');
          if (a.status === 'SETTLED') { w.commitment.held -= a.amount; s.settledSpend += a.amount; }
          if (a.status === 'FAILED' && w.commitment.closed) w.commitment.held -= a.amount;
        } else {
          const o = own(s.obligations, a.targetId);
          requireThat(o && o.status === 'IN_FLIGHT' && o.attemptId === a.id, 'OBLIGATION_BINDING');
          if (a.status === 'SETTLED') { o.status = 'SETTLED'; s.settledRefunds += a.amount; }
          if (a.status === 'FAILED') { o.status = 'OPEN'; o.attemptId = null; }
        }
        this.remember(s, c);
        return { observedStatus: a.status, source: 'FAKE_ADAPTER', realSettlement: false };
      }
    }
  }

  exportAudit(): AuditBundle {
    return copy({ schema: 'nymrel.agent-work.audit/0.1', integrity: 'UNSIGNED_HASH_CHAIN', config: this.config,
      genesisHash: this.genesis, records: this.records, head: this.head(),
      merkleRoot: new MerkleTree(this.records.map(r => r.hash), { isPreHashed: true }).getRoot(),
      finalStateHash: canonicalHash(this.state) });
  }

  /** Unsigned source observation compatible with a FUTURE externally retained checkpoint. */
  checkpointSource(): CheckpointSource {
    return { sourceProtocol: 'nymrel.agent-work.simulation', sourceVersion: '0.1.0',
      sourceId: this.config.simulationId, sourceEpochDigest: `sha256:${this.genesis}` };
  }
  observePrefix(eventCount: number): Record<string, unknown> {
    requireThat(Number.isSafeInteger(eventCount) && eventCount >= 0 && eventCount <= this.records.length, 'PREFIX_UNAVAILABLE');
    return { status: 'VALID', ...this.checkpointSource(), eventCount: this.records.length,
      prefixHash: `sha256:${eventCount === 0 ? this.genesis : this.records[eventCount - 1].hash}` };
  }

  static async replay(input: unknown, expectedHead?: string): Promise<{ valid: boolean; code: string; authenticity: 'UNSIGNED'; actionTruth: 'NOT_ESTABLISHED'; eventCount: number }> {
    const fail = (code: string) => ({ valid: false, code, authenticity: 'UNSIGNED' as const, actionTruth: 'NOT_ESTABLISHED' as const, eventCount: 0 });
    try {
      const b: unknown = copy(input);
      if (!exact(b, 'schema integrity config genesisHash records head merkleRoot finalStateHash') || b.schema !== 'nymrel.agent-work.audit/0.1' || b.integrity !== 'UNSIGNED_HASH_CHAIN' || !Array.isArray(b.records) || b.records.length > MAX_RECORDS) return fail('AUDIT_SHAPE');
      validateConfig(b.config);
      const sim = new Simulation(b.config);
      if (sim.genesis !== b.genesisHash) return fail('GENESIS_MISMATCH');
      for (const record of b.records) {
        if (!exact(record, 'sequence previousHash principal command outcome stateHash hash') || !exact(record.principal, 'kind id')) return fail('RECORD_SHAPE');
        const p = record.principal;
        const allowed = (p.kind === 'agent' && p.id === b.config.agent.id) || (p.kind === 'operator' && p.id === 'fixtureOperator') || (p.kind === 'fake-rail' && p.id === 'fixtureRail') || (p.kind === 'customer' && b.config.scopes.some(s => s.customerId === p.id));
        if (!allowed) return fail('PRINCIPAL_MISMATCH');
        const before = sim.records.length;
        await sim.submit(p as Principal, record.command);
        if (sim.records.length !== before + 1 || canonicalize(sim.records.at(-1)) !== canonicalize(record)) return fail('REPLAY_MISMATCH');
      }
      if (canonicalize(sim.exportAudit()) !== canonicalize(b)) return fail('FINAL_BINDING_MISMATCH');
      if (expectedHead !== undefined && expectedHead !== b.head) return fail('RETAINED_HEAD_MISMATCH');
      return { valid: true, code: expectedHead === undefined ? 'INTEGRITY_ONLY_NO_EXTERNAL_PIN' : 'REPLAY_MATCHES_RETAINED_HEAD', authenticity: 'UNSIGNED', actionTruth: 'NOT_ESTABLISHED', eventCount: b.records.length };
    } catch { return fail('MALFORMED_AUDIT'); }
  }

  /** Restore only after deterministic replay and comparison with an independently retained head. */
  static async restore(bundle: AuditBundle, expectedHead: string): Promise<Simulation> {
    requireThat(typeof expectedHead === 'string' && SHA256.test(expectedHead), 'RETAINED_HEAD_REQUIRED');
    const snapshot = copy(bundle);
    const result = await Simulation.replay(snapshot, expectedHead);
    requireThat(result.valid, result.code);
    const sim = new Simulation(snapshot.config);
    for (const record of snapshot.records) await sim.submit(record.principal, record.command);
    return sim;
  }
}
