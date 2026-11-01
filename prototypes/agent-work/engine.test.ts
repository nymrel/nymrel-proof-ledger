import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash } from '../../src/core/canonical.js';
import { hashArtifact } from '../../src/core/receipt.js';
import { Simulation } from './engine.js';
import { fixtureConfig, listing, observation } from './fixtures.js';
import { releasePacket } from './work-adapter.js';
import type { AgentCommand, Config, Outcome, RailCommand, Status } from './contracts.js';

function setup(config: Config = fixtureConfig()): Simulation { return new Simulation(config); }
async function ok(result: Promise<Outcome>): Promise<Outcome> {
  const outcome = await result; assert.equal(outcome.ok, true, outcome.code); return outcome;
}
async function refused(result: Promise<Outcome>, code: string): Promise<void> {
  const outcome = await result; assert.equal(outcome.ok, false); assert.equal(outcome.code, code);
}
async function assign(sim: Simulation, workId = 'packet'): Promise<void> {
  await ok(sim.agent({ type: 'discover_work', requestId: `discover_${workId}`, workId }));
  await ok(sim.agent({ type: 'scope_assignment', requestId: `scope_${workId}`, workId }));
  await ok(sim.agent({ type: 'accept_assignment', requestId: `assign_${workId}`, workId }));
}
async function deliver(sim: Simulation, workId = 'packet'): Promise<void> {
  await assign(sim, workId);
  await ok(sim.agent({ type: 'begin_work', requestId: `execute_${workId}`, workId }));
  const content = sim.snapshot().works[workId].execution!.output.content;
  await ok(sim.agent({ type: 'deliver_artifact', requestId: `deliver_${workId}`, workId, content }));
}
function acceptance(sim: Simulation, requestId = 'accept', workId = 'packet') {
  const w = sim.snapshot().works[workId];
  return { type: 'accept_delivery' as const, requestId, workId, artifactSha256: w.artifact!.sha256, scopeDigest: w.scopeDigest!, criteriaRevision: w.listing.criteriaRevision };
}
async function invoice(sim: Simulation, workId = 'packet'): Promise<void> {
  await deliver(sim, workId);
  await ok(sim.customer('fictionalCustomer')(acceptance(sim, `accept_${workId}`, workId)));
  await ok(sim.agent({ type: 'issue_invoice', requestId: `invoice_${workId}`, workId }));
}
function earning(requestId: string, status: Status, amount = 500, sequence = 1, paymentId = 'paymentOne', receiptId = requestId): RailCommand {
  return { type: 'observe_earning', requestId, invoiceId: 'invoice_packet', paymentId, observation: observation(receiptId, sequence, status, amount) };
}

test('frozen assignment, bounded deterministic saved-page artifact and separate customer acceptance', async () => {
  const sim = setup(); await deliver(sim);
  const w = sim.snapshot().works.packet;
  assert.equal(w.stage, 'DELIVERED');
  const packet = releasePacket(w.listing);
  assert.equal(packet, releasePacket(w.listing));
  assert.equal(w.artifact!.sha256, (await hashArtifact('delivery.txt', packet, '/offline-simulation')).sha256);
  const content = JSON.parse(packet) as { findings: { failures: string[] }[]; networkAccess: boolean };
  assert.equal(content.networkAccess, false);
  assert.deepEqual(content.findings.map(f => f.failures), [[], []]);
  assert.equal(w.execution!.realCost, null); assert.equal(w.execution!.costKnowledge, 'UNKNOWN');
  assert.equal(w.scopeDigest, canonicalHash({ listing: w.listing, scope: fixtureConfig().scopes[0] }));
  await refused(sim.agent(acceptance(sim)), 'ROLE_DENIED');
  await refused(sim.agent({ type: 'issue_invoice', requestId: 'earlyInvoice', workId: 'packet' }), 'CUSTOMER_ACCEPTANCE_REQUIRED');
  await ok(sim.customer('fictionalCustomer')(acceptance(sim)));
  await ok(sim.agent({ type: 'issue_invoice', requestId: 'invoice', workId: 'packet' }));
  assert.equal(sim.balance().settledEarnings, 0);
});

test('worker command flow runs the saved-page checker and refuses arbitrary or altered delivery bytes', async () => {
  const config = fixtureConfig();
  config.catalog[0].pages[0].status = 404;
  const sim = setup(config); await assign(sim);
  await ok(sim.agent({ type: 'begin_work', requestId: 'execute', workId: 'packet' }));
  const execution = sim.snapshot().works.packet.execution!;
  const packet = JSON.parse(execution.output.content) as { findings: { failures: string[] }[] };
  assert.deepEqual(packet.findings[0].failures, ['STATUS']);
  assert.equal(execution.output.artifact.sha256, (await hashArtifact('delivery.txt', execution.output.content, '/offline-simulation')).sha256);
  const before = sim.snapshot();
  await refused(sim.agent({ type: 'deliver_artifact', requestId: 'arbitrary', workId: 'packet', content: 'No checks were performed' }), 'DELIVERY_CONTENT_MISMATCH');
  await refused(sim.agent({ type: 'deliver_artifact', requestId: 'altered', workId: 'packet', content: execution.output.content + ' ' }), 'DELIVERY_CONTENT_MISMATCH');
  assert.deepEqual(sim.snapshot(), before);
  await refused(sim.agent({ type: 'issue_invoice', requestId: 'noInvoice', workId: 'packet' }), 'CUSTOMER_ACCEPTANCE_REQUIRED');
  await ok(sim.agent({ type: 'deliver_artifact', requestId: 'deliver', workId: 'packet', content: execution.output.content }));
  await ok(sim.customer('fictionalCustomer')(acceptance(sim)));
  await ok(sim.agent({ type: 'issue_invoice', requestId: 'invoice', workId: 'packet' }));
});

test('oversized generated packets are ineligible before assignment or credit reservation', async () => {
  const config = fixtureConfig();
  const work = config.catalog[0];
  work.pages = Array.from({ length: 10 }, (_, index) => ({
    pageId: `page${index}`, status: 200, title: `Page ${index}`,
    canonical: `https://fictional.invalid/page${index}`,
    links: Array.from({ length: 32 }, (_, link) => `/${index}_${link}_${'x'.repeat(190)}`),
  }));
  work.manifest = work.pages.map(page => ({ pageId: page.pageId, status: page.status, title: page.title,
    canonical: page.canonical, requiredLinks: [...page.links] }));
  assert.ok(Buffer.byteLength(releasePacket(work), 'utf8') > 8192);
  const sim = setup(config);
  await refused(sim.agent({ type: 'discover_work', requestId: 'oversized', workId: 'packet' }), 'INELIGIBLE_PACKET_TOO_LARGE');
  await refused(sim.agent({ type: 'accept_assignment', requestId: 'cannotReserve', workId: 'packet' }), 'WORK_NOT_FOUND');
  assert.deepEqual(sim.snapshot().works, {});
  assert.equal(sim.balance().commitments, 0);
  assert.equal(sim.balance().available, 800);
});

test('accepted work cannot create a new invoice at or beyond its deadline', async () => {
  for (const tick of [100, 101]) {
    const sim = setup(); await deliver(sim);
    await ok(sim.customer('fictionalCustomer')(acceptance(sim)));
    await ok(sim.operator({ type: 'advance_clock', requestId: 'advance', tick }));
    const before = sim.snapshot();
    await refused(sim.agent({ type: 'issue_invoice', requestId: 'lateInvoice', workId: 'packet' }), 'ASSIGNMENT_EXPIRED');
    assert.deepEqual(sim.snapshot(), before);
    assert.deepEqual(sim.snapshot().invoices, {});
  }
});

test('deadline blocks new invoicing while existing invoice retries and observations remain reconcilable', async () => {
  const sim = setup(); await invoice(sim);
  await ok(sim.operator({ type: 'advance_clock', requestId: 'advance', tick: 100 }));
  const originalInvoice = sim.snapshot().invoices.invoice_packet;
  const retry = await ok(sim.agent({ type: 'issue_invoice', requestId: 'invoice_packet', workId: 'packet' }));
  assert.equal(retry.replayed, true);
  assert.deepEqual(sim.snapshot().invoices.invoice_packet, originalInvoice);
  await ok(sim.fakeRail(earning('settledLater', 'SETTLED')));
  assert.equal(sim.balance().settledEarnings, 500);
});

test('wrong customer, forged authority, artifact substitution and stale criteria are refused', async () => {
  const sim = setup(); await deliver(sim);
  await refused(sim.customer('otherCustomer')(acceptance(sim, 'wrongCustomer')), 'CUSTOMER_MISMATCH');
  await refused(sim.agent({ ...acceptance(sim, 'forged'), actor: 'fictionalCustomer' }), 'COMMAND_SHAPE');
  await refused(sim.customer('fictionalCustomer')({ ...acceptance(sim, 'wrongArtifact'), artifactSha256: '0'.repeat(64) }), 'DELIVERY_BINDING');
  await refused(sim.customer('fictionalCustomer')({ ...acceptance(sim, 'wrongCriteria'), criteriaRevision: 'criteriaV2' }), 'CRITERIA_BINDING');
  await refused(sim.customer('fictionalCustomer')({ ...acceptance(sim, 'wrongScope'), scopeDigest: '0'.repeat(64) }), 'CRITERIA_BINDING');
  assert.equal(sim.snapshot().works.packet.stage, 'DELIVERED');
});

test('pending, unknown and receivable units never become spendable; partial settlement is explicit', async () => {
  const sim = setup(); await invoice(sim);
  assert.equal(sim.balance().available, 650);
  await ok(sim.fakeRail(earning('pending', 'PENDING', 200)));
  assert.equal(sim.balance().pendingEarnings, 200); assert.equal(sim.balance().available, 650);
  await ok(sim.fakeRail(earning('unknown', 'UNKNOWN', 200, 2)));
  assert.equal(sim.balance().uncertainEarnings, 200); assert.equal(sim.balance().available, 650);
  await ok(sim.fakeRail(earning('partial', 'SETTLED', 200, 3)));
  assert.equal(sim.snapshot().invoices.invoice_packet.status, 'PARTIALLY_PAID');
  assert.equal(sim.balance().settledEarnings, 200); assert.equal(sim.balance().available, 850);
  await ok(sim.fakeRail(earning('rest', 'SETTLED', 300, 1, 'paymentTwo')));
  assert.equal(sim.snapshot().invoices.invoice_packet.status, 'SETTLED');
  assert.equal(sim.balance().available, 1150);
  await refused(sim.fakeRail(earning('overpaid', 'SETTLED', 1, 1, 'paymentThree')), 'PAYMENT_EXCEEDS_INVOICE');
});

test('duplicate and conflicting receipt references cannot mint credits', async () => {
  const sim = setup(); await invoice(sim);
  const settled = earning('settled', 'SETTLED');
  await ok(sim.fakeRail(settled));
  await ok(sim.fakeRail({ ...settled, requestId: 'duplicate' }));
  assert.equal(sim.balance().settledEarnings, 500);
  await refused(sim.fakeRail({ ...earning('conflict', 'SETTLED', 499), observation: observation('settled', 1, 'SETTLED', 499) }), 'RECEIPT_CONFLICT');
  await refused(sim.fakeRail(earning('terminal', 'SETTLED', 500, 2)), 'TERMINAL_OBSERVATION');
  assert.equal(sim.balance().settledEarnings, 500);
});

test('out-of-order receipts leave no consumed reference and can be resubmitted in order', async () => {
  const sim = setup(); await invoice(sim);
  const second = earning('secondEarly', 'SETTLED', 500, 2, 'paymentOne', 'secondReceipt');
  await refused(sim.fakeRail(second), 'RECEIPT_OUT_OF_ORDER');
  assert.deepEqual(sim.snapshot().payments, {});
  assert.deepEqual(sim.snapshot().receipts, {});
  await ok(sim.fakeRail(earning('first', 'PENDING')));
  await ok(sim.fakeRail({ ...second, requestId: 'secondOrdered' }));
  assert.equal(sim.balance().settledEarnings, 500);
});

test('receipt amount, source, denomination and payment-to-invoice binding are enforced', async () => {
  const sim = setup(); await invoice(sim); await invoice(sim, 'another');
  await ok(sim.fakeRail(earning('pending', 'PENDING', 200)));
  await refused(sim.fakeRail(earning('wrongAmount', 'SETTLED', 201, 2)), 'AMOUNT_BINDING');
  await refused(sim.fakeRail({ ...earning('wrongInvoice', 'SETTLED', 200, 2), invoiceId: 'invoice_another' }), 'PAYMENT_BINDING');
  await refused(sim.fakeRail({ ...earning('usd', 'SETTLED'), observation: { ...observation('usdReceipt', 1, 'SETTLED', 500), unit: 'USD' } }), 'OBSERVATION');
  await refused(sim.fakeRail({ ...earning('real', 'SETTLED'), observation: { ...observation('realReceipt', 1, 'SETTLED', 500), source: 'REAL_PROVIDER' } }), 'OBSERVATION');
  await refused(sim.agent(earning('agentReceipt', 'SETTLED')), 'ROLE_DENIED');
  assert.equal(sim.balance().settledEarnings, 0);
});

test('exact retry returns its original result; changed payload conflicts; requests are snapshotted', async () => {
  const sim = setup();
  const command: AgentCommand = { type: 'discover_work', requestId: 'once', workId: 'packet' };
  const first = await ok(sim.agent(command));
  const retry = await ok(sim.agent(command));
  assert.deepEqual(retry, { ...first, replayed: true });
  assert.equal(sim.exportAudit().records.length, 1);
  await refused(sim.agent({ ...command, workId: 'another' }), 'IDEMPOTENCY_CONFLICT');
  const mutable = { type: 'discover_work', requestId: 'snapshot', workId: 'another' };
  const result = sim.agent(mutable); mutable.workId = 'malicious'; await ok(result);
  assert.ok(sim.snapshot().works.another); assert.equal(sim.snapshot().works.malicious, undefined);
});

test('concurrent commitments use one atomic availability check', async () => {
  const config = fixtureConfig(); config.openingCredits = 450; // Available 250: only one 150 commitment fits.
  const sim = setup(config);
  for (const workId of ['packet', 'another']) {
    await ok(sim.agent({ type: 'discover_work', requestId: `d_${workId}`, workId }));
    await ok(sim.agent({ type: 'scope_assignment', requestId: `s_${workId}`, workId }));
  }
  const results = await Promise.all(['packet', 'another'].map(workId => sim.agent({ type: 'accept_assignment', requestId: `a_${workId}`, workId })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok)!.code, 'INSUFFICIENT_AVAILABLE');
  assert.equal(sim.balance().commitments, 150); assert.equal(sim.balance().available, 100);
});

test('concurrent spend attempts cannot consume the same held capacity', async () => {
  const sim = setup(); await assign(sim);
  const results = await Promise.all(['attemptA', 'attemptB'].map(attemptId => sim.agent({ type: 'begin_spend', requestId: attemptId, workId: 'packet', attemptId, amount: 100 })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok)!.code, 'RESERVATION_EXCEEDED');
  assert.equal(Object.keys(sim.snapshot().attempts).length, 1);
});

test('insufficient cash and budget fail atomically; pending earnings cannot fund commitments', async () => {
  const config = fixtureConfig(); config.openingCredits = 350;
  const sim = setup(config); await invoice(sim);
  await ok(sim.fakeRail(earning('pending', 'PENDING')));
  await ok(sim.agent({ type: 'discover_work', requestId: 'discoverOther', workId: 'another' }));
  await ok(sim.agent({ type: 'scope_assignment', requestId: 'scopeOther', workId: 'another' }));
  const before = sim.snapshot();
  await refused(sim.agent({ type: 'accept_assignment', requestId: 'cannotFund', workId: 'another' }), 'INSUFFICIENT_AVAILABLE');
  assert.deepEqual(sim.snapshot(), before);
  const budgetConfig = fixtureConfig(); budgetConfig.spendBudget = 149;
  const budgetSim = setup(budgetConfig);
  await ok(budgetSim.agent({ type: 'discover_work', requestId: 'd', workId: 'packet' }));
  await ok(budgetSim.agent({ type: 'scope_assignment', requestId: 's', workId: 'packet' }));
  await refused(budgetSim.agent({ type: 'accept_assignment', requestId: 'a', workId: 'packet' }), 'INSUFFICIENT_AVAILABLE');
});

test('unknown spend retains its reservation through cancellation, revocation and replay', async () => {
  const sim = setup(); await assign(sim);
  await ok(sim.agent({ type: 'begin_spend', requestId: 'start', workId: 'packet', attemptId: 'attempt', amount: 100 }));
  await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'unknown', attemptId: 'attempt', observation: observation('unknownSpend', 1, 'UNKNOWN', 100) }));
  await ok(sim.operator({ type: 'revoke_scope', requestId: 'revoke', scopeId: 'releaseScope' }));
  await ok(sim.agent({ type: 'cancel_work', requestId: 'cancel', workId: 'packet' }));
  assert.equal(sim.balance().commitments, 100); assert.equal(sim.balance().available, 700);
  const bundle = sim.exportAudit();
  const restored = await Simulation.restore(bundle, bundle.head);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
  await ok(restored.fakeRail({ type: 'observe_spend', requestId: 'final', attemptId: 'attempt', observation: observation('settledSpend', 2, 'SETTLED', 100) }));
  assert.equal(restored.balance().commitments, 0); assert.equal(restored.balance().settledSpend, 100);
  assert.equal(restored.balance().available, 700);
  const retry = await ok(restored.agent({ type: 'begin_spend', requestId: 'start', workId: 'packet', attemptId: 'attempt', amount: 100 }));
  assert.equal(retry.replayed, true); assert.equal(restored.snapshot().attempts.attempt.status, 'SETTLED');
});

test('failed spend can be retried, but only explicit closure releases the unused commitment', async () => {
  const sim = setup(); await assign(sim);
  await ok(sim.agent({ type: 'begin_spend', requestId: 'a', workId: 'packet', attemptId: 'first', amount: 150 }));
  await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'failed', attemptId: 'first', observation: observation('failedReceipt', 1, 'FAILED', 150) }));
  assert.equal(sim.balance().commitments, 150); assert.equal(sim.balance().settledSpend, 0);
  await ok(sim.agent({ type: 'begin_spend', requestId: 'b', workId: 'packet', attemptId: 'second', amount: 150 }));
  await ok(sim.agent({ type: 'close_commitment', requestId: 'close', workId: 'packet' }));
  assert.equal(sim.balance().commitments, 150);
  await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'failedAgain', attemptId: 'second', observation: observation('failedReceiptTwo', 1, 'FAILED', 150) }));
  assert.equal(sim.balance().commitments, 0); assert.equal(sim.balance().available, 800);
});

test('scope revocation blocks new execution and delivery; version and deadline are checked', async () => {
  const sim = setup(); await assign(sim);
  await refused(sim.agent({ type: 'begin_work', requestId: 'stale', expectedRevision: 0, workId: 'packet' }), 'STALE_REVISION');
  await ok(sim.agent({ type: 'begin_work', requestId: 'begin', workId: 'packet' }));
  await ok(sim.operator({ type: 'revoke_scope', requestId: 'revoke', scopeId: 'releaseScope' }));
  await refused(sim.agent({ type: 'deliver_artifact', requestId: 'deliver', workId: 'packet', content: 'late' }), 'SCOPE_REVOKED');
  await refused(sim.agent({ type: 'revoke_scope', requestId: 'workerRevoke', scopeId: 'releaseScope' }), 'ROLE_DENIED');
  assert.equal(sim.balance().commitments, 150);
  const expiring = setup(); await assign(expiring);
  await ok(expiring.operator({ type: 'advance_clock', requestId: 'time', tick: 100 }));
  await refused(expiring.agent({ type: 'begin_work', requestId: 'late', workId: 'packet' }), 'ASSIGNMENT_EXPIRED');
  await ok(expiring.operator({ type: 'expire_work', requestId: 'expire', workId: 'packet' }));
  assert.equal(expiring.snapshot().works.packet.stage, 'EXPIRED'); assert.equal(expiring.balance().commitments, 0);
  assert.equal(expiring.balance().settledEarnings, 0);
});

test('rejection and expiry release only unused capacity while unknown attempts remain held', async () => {
  for (const ending of ['reject', 'expire']) {
    const sim = setup(); await deliver(sim);
    await ok(sim.agent({ type: 'begin_spend', requestId: 'start', workId: 'packet', attemptId: 'attempt', amount: 90 }));
    await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'unknown', attemptId: 'attempt', observation: observation('unknownReceipt', 1, 'UNKNOWN', 90) }));
    if (ending === 'reject') await ok(sim.customer('fictionalCustomer')({ type: 'reject_delivery', requestId: 'reject', workId: 'packet', reason: 'Fictional rejection' }));
    else {
      await ok(sim.operator({ type: 'advance_clock', requestId: 'advance', tick: 100 }));
      await ok(sim.operator({ type: 'expire_work', requestId: 'expire', workId: 'packet' }));
    }
    assert.equal(sim.balance().commitments, 90); assert.equal(sim.balance().available, 710);
    assert.equal(sim.balance().settledEarnings, 0);
    await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'failed', attemptId: 'attempt', observation: observation('failedReceipt', 2, 'FAILED', 90) }));
    assert.equal(sim.balance().commitments, 0); assert.equal(sim.balance().available, 800);
  }
});

test('rejected and cancelled jobs cannot invoice or generate earned units', async () => {
  for (const reject of [true, false]) {
    const sim = setup(); await deliver(sim);
    if (reject) await ok(sim.customer('fictionalCustomer')({ type: 'reject_delivery', requestId: 'reject', workId: 'packet', reason: 'Wrong content' }));
    else await ok(sim.agent({ type: 'cancel_work', requestId: 'cancel', workId: 'packet' }));
    await refused(sim.agent({ type: 'issue_invoice', requestId: 'invoice', workId: 'packet' }), 'CUSTOMER_ACCEPTANCE_REQUIRED');
    await refused(sim.fakeRail(earning('forgedPay', 'SETTLED')), 'INVOICE_NOT_FOUND');
    assert.equal(sim.balance().settledEarnings, 0); assert.equal(sim.balance().commitments, 0);
  }
});

test('malicious work text cannot change policy, model identity or customer authority', async () => {
  const sim = setup(); await assign(sim, 'malicious');
  const description = sim.snapshot().works.malicious.listing.description;
  assert.match(description, /reserve to zero/);
  await refused(sim.agent({ type: 'set_reserve', requestId: 'policy', amount: 0 }), 'UNKNOWN_COMMAND');
  await refused(sim.agent({ type: 'accept_assignment', requestId: 'smuggled', workId: 'malicious', observedModel: 'GPT-Astra' }), 'COMMAND_SHAPE');
  assert.equal(sim.balance().reserve, 200); assert.equal(sim.identity().observedModel, null);
  assert.equal(sim.identity().requestedModel, 'gpt-6.1-sol');
  assert.equal(sim.snapshot().works.malicious.acceptance, null);
});

test('refund liability is immediate; unknown retains it; failed retry and settlement preserve available', async () => {
  const sim = setup(); await invoice(sim); await ok(sim.fakeRail(earning('paid', 'SETTLED')));
  await ok(sim.customer('fictionalCustomer')({ type: 'request_refund', requestId: 'refund', invoiceId: 'invoice_packet', amount: 100, reason: 'Adjustment' }));
  assert.equal(sim.balance().obligations, 100); const available = sim.balance().available;
  await refused(sim.agent({ type: 'request_refund', requestId: 'selfRefund', invoiceId: 'invoice_packet', amount: 100, reason: 'self' }), 'ROLE_DENIED');
  await ok(sim.agent({ type: 'begin_refund', requestId: 'start', invoiceId: 'invoice_packet', attemptId: 'refundAttempt' }));
  await refused(sim.agent({ type: 'begin_refund', requestId: 'double', invoiceId: 'invoice_packet', attemptId: 'doubleAttempt' }), 'OPEN_OBLIGATION_REQUIRED');
  await ok(sim.fakeRail({ type: 'observe_refund', requestId: 'unknown', attemptId: 'refundAttempt', observation: observation('unknownRefund', 1, 'UNKNOWN', 100) }));
  assert.equal(sim.balance().available, available); assert.equal(sim.balance().obligations, 100);
  await ok(sim.fakeRail({ type: 'observe_refund', requestId: 'failed', attemptId: 'refundAttempt', observation: observation('failedRefund', 2, 'FAILED', 100) }));
  assert.equal(sim.balance().obligations, 100);
  await ok(sim.agent({ type: 'begin_refund', requestId: 'retry', invoiceId: 'invoice_packet', attemptId: 'retryAttempt' }));
  const settled: RailCommand = { type: 'observe_refund', requestId: 'settled', attemptId: 'retryAttempt', observation: observation('settledRefund', 1, 'SETTLED', 100) };
  await ok(sim.fakeRail(settled)); await ok(sim.fakeRail({ ...settled, requestId: 'dup' }));
  assert.equal(sim.balance().obligations, 0); assert.equal(sim.balance().settledRefunds, 100);
  assert.equal(sim.balance().available, available);
});

test('refund limits, dispute ownership, and liabilities that expose shortfall fail safely', async () => {
  const config = fixtureConfig(); config.openingCredits = 350; config.spendBudget = 1000;
  config.catalog.push(listing('large', 500));
  const sim = setup(config); await invoice(sim); await ok(sim.fakeRail(earning('paid', 'SETTLED')));
  await ok(sim.agent({ type: 'close_commitment', requestId: 'close', workId: 'packet' }));
  await assign(sim, 'large');
  await refused(sim.customer('otherCustomer')({ type: 'dispute_invoice', requestId: 'wrong', invoiceId: 'invoice_packet', reason: 'Wrong customer' }), 'CUSTOMER_MISMATCH');
  await ok(sim.customer('fictionalCustomer')({ type: 'dispute_invoice', requestId: 'dispute', invoiceId: 'invoice_packet', reason: 'Adjustment' }));
  await refused(sim.customer('fictionalCustomer')({ type: 'request_refund', requestId: 'tooMuch', invoiceId: 'invoice_packet', amount: 501, reason: 'Too much' }), 'REFUND_LIMIT');
  await ok(sim.customer('fictionalCustomer')({ type: 'request_refund', requestId: 'refund', invoiceId: 'invoice_packet', amount: 500, reason: 'Full refund' }));
  assert.equal(sim.balance().shortfall, 350); assert.equal(sim.balance().spendable, 0);
  await refused(sim.agent({ type: 'begin_refund', requestId: 'unfunded', invoiceId: 'invoice_packet', attemptId: 'refundAttempt' }), 'REFUND_UNFUNDED');
  await refused(sim.agent({ type: 'begin_spend', requestId: 'spend', workId: 'large', attemptId: 'newSpend', amount: 1 }), 'INSUFFICIENT_AVAILABLE');
  await ok(sim.agent({ type: 'close_commitment', requestId: 'release', workId: 'large' }));
  assert.equal(sim.balance().shortfall, 0);
  await ok(sim.agent({ type: 'begin_refund', requestId: 'funded', invoiceId: 'invoice_packet', attemptId: 'refundAttempt' }));
});

test('an open dispute blocks new discretionary spending on that job', async () => {
  const sim = setup(); await invoice(sim);
  await ok(sim.customer('fictionalCustomer')({ type: 'dispute_invoice', requestId: 'dispute', invoiceId: 'invoice_packet', reason: 'Review' }));
  await refused(sim.agent({ type: 'begin_spend', requestId: 'spend', workId: 'packet', attemptId: 'spendAttempt', amount: 10 }), 'DISPUTED_WORK');
  await ok(sim.customer('fictionalCustomer')({ type: 'resolve_dispute', requestId: 'resolve', invoiceId: 'invoice_packet' }));
  await ok(sim.agent({ type: 'begin_spend', requestId: 'newSpend', workId: 'packet', attemptId: 'spendAttempt', amount: 10 }));
});

test('dispute reserves hold settled receipts and do not double-count refund obligations', async () => {
  const sim = setup(); await invoice(sim);
  await ok(sim.customer('fictionalCustomer')({ type: 'dispute_invoice', requestId: 'dispute', invoiceId: 'invoice_packet', reason: 'Review' }));
  const before = sim.balance().available;
  await ok(sim.fakeRail(earning('paid', 'SETTLED')));
  assert.equal(sim.balance().disputeReserves, 500); assert.equal(sim.balance().available, before);
  await ok(sim.customer('fictionalCustomer')({ type: 'request_refund', requestId: 'refund', invoiceId: 'invoice_packet', amount: 100, reason: 'Adjustment' }));
  assert.equal(sim.balance().disputeReserves, 400); assert.equal(sim.balance().obligations, 100);
  assert.equal(sim.balance().available, before);
  await ok(sim.customer('fictionalCustomer')({ type: 'resolve_dispute', requestId: 'resolve', invoiceId: 'invoice_packet' }));
  assert.equal(sim.balance().available, before + 400);
});

test('reference arithmetic separates seed funding, reserves, commitments and settled spend', async () => {
  const sim = setup(); await assign(sim, 'commitment'); await assign(sim, 'spent');
  await ok(sim.agent({ type: 'begin_spend', requestId: 'start', workId: 'spent', attemptId: 'spendAttempt', amount: 300 }));
  await ok(sim.fakeRail({ type: 'observe_spend', requestId: 'settle', attemptId: 'spendAttempt', observation: observation('spentReceipt', 1, 'SETTLED', 300) }));
  const b = sim.balance();
  assert.equal(b.opening, 1000); assert.equal(b.reserve, 200); assert.equal(b.commitments, 150);
  assert.equal(b.settledSpend, 300); assert.equal(b.settledEarnings, 0); assert.equal(b.available, 350);
});

test('replay catches mutation, reordering and truncation against an independent retained head', async () => {
  const sim = setup(); await invoice(sim); await ok(sim.fakeRail(earning('paid', 'SETTLED')));
  const bundle = sim.exportAudit(); const head = bundle.head;
  await assert.rejects(Simulation.restore(bundle, ''), /RETAINED_HEAD_REQUIRED/);
  assert.equal((await Simulation.replay(bundle, head)).valid, true);
  assert.equal((await Simulation.replay(bundle)).code, 'INTEGRITY_ONLY_NO_EXTERNAL_PIN');
  const changed = structuredClone(bundle); changed.records[0].outcome.code = 'FORGED';
  assert.equal((await Simulation.replay(changed, head)).valid, false);
  const reordered = structuredClone(bundle); reordered.records.reverse();
  assert.equal((await Simulation.replay(reordered, head)).valid, false);
  const earlier = setup(); await deliver(earlier);
  assert.equal((await Simulation.replay(earlier.exportAudit(), head)).code, 'RETAINED_HEAD_MISMATCH');
  const result = await Simulation.replay(bundle, head);
  assert.equal(result.authenticity, 'UNSIGNED'); assert.equal(result.actionTruth, 'NOT_ESTABLISHED');
  assert.deepEqual(sim.observePrefix(0), { status: 'VALID', ...sim.checkpointSource(), eventCount: bundle.records.length, prefixHash: `sha256:${bundle.genesisHash}` });
  assert.equal(sim.observePrefix(bundle.records.length).prefixHash, `sha256:${head}`);
});

test('configuration and untrusted JSON reject live units, invalid arithmetic, oversized work and self-customers', async () => {
  const live = fixtureConfig(); (live.accounting as { unit: string }).unit = 'USD';
  assert.throws(() => setup(live), /FAKE_UNIT_REQUIRED/);
  const fractional = fixtureConfig(); fractional.openingCredits = 1.1; assert.throws(() => setup(fractional), /CONFIG_AMOUNTS/);
  const over = fixtureConfig(); over.catalog[0].pages = Array.from({ length: 11 }, () => over.catalog[0].pages[0]); assert.throws(() => setup(over), /PAGE_LIMIT/);
  const self = fixtureConfig(); self.scopes[0].customerId = self.agent.id; assert.throws(() => setup(self), /CONFIG_SCOPE/);
  const sim = setup();
  await refused(sim.agent({ type: 'discover_work', requestId: 'r', workId: '__proto__' }), 'IDENTIFIER');
  await refused(sim.agent({ type: 'begin_spend', requestId: 'fraction', workId: 'packet', attemptId: 'attempt', amount: 1.5 }), 'AMOUNT');
  await refused(sim.agent({ bad: Infinity }), 'JSON_BOUNDARY');
  const accessor = { get type() { throw Error('must not run'); } };
  await refused(sim.agent(accessor), 'JSON_BOUNDARY');
  assert.equal(sim.exportAudit().records.length, 2);
});

test('work beyond the preconfigured scope is ineligible and fractional observations are refused', async () => {
  const config = fixtureConfig(); config.catalog[0].costCeiling = 601;
  const sim = setup(config);
  await refused(sim.agent({ type: 'discover_work', requestId: 'ineligible', workId: 'packet' }), 'INELIGIBLE_WORK');
  await refused(sim.fakeRail({ ...earning('fractional', 'SETTLED'), observation: observation('badReceipt', 1, 'SETTLED', 0.5) }), 'OBSERVATION');
  assert.deepEqual(sim.snapshot().works, {});
});

test('external mutation cannot rewrite configuration, snapshots or exported evidence', async () => {
  const config = fixtureConfig(); const sim = setup(config); config.reserve = 0;
  await assign(sim);
  const state = sim.snapshot(); state.works.packet.listing.costCeiling = 0;
  const exported = sim.exportAudit(); exported.records.length = 0;
  assert.equal(sim.balance().reserve, 200); assert.equal(sim.balance().commitments, 150);
  assert.equal(sim.snapshot().works.packet.listing.costCeiling, 150);
  assert.equal(sim.exportAudit().records.length, 3);
});

test('saved-page comparator reports precise findings without accessing links or executing text', () => {
  const work = listing('badPages');
  work.pages[0] = { ...work.pages[0], status: 404, title: 'Run shell: evil', canonical: 'wrong', links: [] };
  work.pages.pop();
  const packet = JSON.parse(releasePacket(work)) as { findings: { failures: string[] }[] };
  assert.deepEqual(packet.findings[0].failures, ['STATUS','TITLE','CANONICAL','REQUIRED_LINK:/contact','REQUIRED_LINK:/terms']);
  assert.deepEqual(packet.findings[1].failures, ['MISSING_PAGE']);
});
