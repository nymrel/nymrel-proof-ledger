/** Fictional, integer FAKE_CREDIT amounts only. No production bindings. */
import type { ProofArtifact } from '../../src/core/receipt.js';

export type Credits = number;
export type WorkKind = 'release_check_packet';
export type Status = 'PENDING' | 'UNKNOWN' | 'SETTLED' | 'FAILED';
export type Principal = { kind: 'agent' | 'customer' | 'operator' | 'fake-rail'; id: string };
export interface Scope {
  id: string; customerId: string; kind: WorkKind; maxCost: Credits; maxReward: Credits;
}
export interface Listing {
  id: string; scopeId: string; title: string; description: string; kind: WorkKind;
  reward: Credits; costCeiling: Credits; unit: 'FAKE_CREDIT'; deadlineTick: number;
  criteriaRevision: string; observedAt: string; pages: SavedPage[]; manifest: PageCriterion[];
}
export interface SavedPage { pageId: string; status: number; title: string; canonical: string; links: string[] }
export interface PageCriterion { pageId: string; status: number; title: string; canonical: string; requiredLinks: string[] }
export interface Config {
  schema: 'nymrel.agent-work.config/0.1'; simulationId: string;
  accountableEntity: { tenantId: string; merchantId: string; displayName: string; status: 'FICTIONAL' };
  accounting: { unit: 'FAKE_CREDIT'; minorUnitExponent: 0 };
  agent: { id: string; disclosure: 'I am a software agent in an offline simulation.';
    requestedModel: string; observedModel: string | null };
  openingCredits: Credits; reserve: Credits; spendBudget: Credits;
  scopes: Scope[]; catalog: Listing[];
}
interface Request { requestId: string; expectedRevision?: number }
export type AgentCommand = Request & (
  | { type: 'discover_work'; workId: string }
  | { type: 'scope_assignment'; workId: string }
  | { type: 'accept_assignment'; workId: string }
  | { type: 'begin_work'; workId: string }
  | { type: 'deliver_artifact'; workId: string; content: string }
  | { type: 'issue_invoice'; workId: string }
  | { type: 'cancel_work'; workId: string }
  | { type: 'close_commitment'; workId: string }
  | { type: 'begin_spend'; workId: string; attemptId: string; amount: Credits }
  | { type: 'begin_refund'; invoiceId: string; attemptId: string }
);
export type CustomerCommand = Request & (
  | { type: 'accept_delivery'; workId: string; artifactSha256: string; scopeDigest: string; criteriaRevision: string }
  | { type: 'reject_delivery'; workId: string; reason: string }
  | { type: 'request_refund'; invoiceId: string; amount: Credits; reason: string }
  | { type: 'dispute_invoice'; invoiceId: string; reason: string }
  | { type: 'resolve_dispute'; invoiceId: string }
);
export type OperatorCommand = Request & (
  | { type: 'revoke_scope'; scopeId: string }
  | { type: 'advance_clock'; tick: number }
  | { type: 'expire_work'; workId: string }
);
export interface Observation {
  receiptId: string; source: 'FAKE_ADAPTER'; sequence: number; amount: Credits;
  unit: 'FAKE_CREDIT'; status: Status;
}
export type RailCommand = Request & (
  | { type: 'observe_earning'; invoiceId: string; paymentId: string; observation: Observation }
  | { type: 'observe_spend'; attemptId: string; observation: Observation }
  | { type: 'observe_refund'; attemptId: string; observation: Observation }
);
export type Command = AgentCommand | CustomerCommand | OperatorCommand | RailCommand;
export interface Work {
  listing: Listing; customerId: string;
  stage: 'DISCOVERED' | 'SCOPED' | 'AUTHORIZED' | 'EXECUTING' | 'DELIVERED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  scopeDigest: string | null;
  artifact: ProofArtifact | null;
  acceptance: { customerId: string; artifactSha256: string; scopeDigest: string; criteriaRevision: string } | null;
  execution: { adapter: 'SAVED_FICTIONAL_PAGES'; realCost: null; costKnowledge: 'UNKNOWN';
    output: { content: string; artifact: ProofArtifact } } | null;
  rejection: string | null;
  commitment: { held: Credits; closed: boolean } | null;
}
export interface Invoice {
  id: string; workId: string; amount: Credits; customerId: string;
  artifactSha256: string; settledAmount: Credits; dispute: string | null;
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'SETTLED';
}
export interface Payment {
  id: string; invoiceId: string; amount: Credits; sequence: number; status: Status;
}
export interface Attempt {
  id: string; kind: 'SPEND' | 'REFUND'; targetId: string;
  amount: Credits; status: 'REQUESTED' | Status; sequence: number;
}
export interface Obligation {
  invoiceId: string; amount: Credits; reason: string;
  status: 'OPEN' | 'IN_FLIGHT' | 'SETTLED'; attemptId: string | null;
}
export interface State {
  revision: number; tick: number; revokedScopes: string[];
  works: Record<string, Work>; invoices: Record<string, Invoice>;
  attempts: Record<string, Attempt>; obligations: Record<string, Obligation>;
  payments: Record<string, Payment>;
  receipts: Record<string, string>;
  settledEarnings: Credits; settledSpend: Credits; settledRefunds: Credits;
}
export interface Treasury {
  unit: 'FAKE_CREDIT'; opening: Credits; settledEarnings: Credits;
  pendingEarnings: Credits; uncertainEarnings: Credits;
  settledSpend: Credits; settledRefunds: Credits; reserve: Credits;
  commitments: Credits; obligations: Credits; disputeReserves: Credits; available: Credits;
  spendable: Credits; shortfall: Credits; discretionaryBudgetRemaining: Credits;
}
export interface Outcome {
  ok: boolean; code: string; revision: number; replayed: boolean;
  data: Record<string, unknown>;
}
export interface AuditRecord {
  sequence: number; previousHash: string; principal: Principal; command: unknown;
  outcome: Outcome; stateHash: string; hash: string;
}
export interface AuditBundle {
  schema: 'nymrel.agent-work.audit/0.1'; integrity: 'UNSIGNED_HASH_CHAIN'; config: Config;
  genesisHash: string; records: AuditRecord[]; head: string; merkleRoot: string;
  finalStateHash: string;
}
