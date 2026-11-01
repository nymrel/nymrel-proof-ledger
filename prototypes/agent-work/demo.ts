import { Simulation } from './engine.js';
import { fixtureConfig, observation } from './fixtures.js';
import type { AgentCommand, CustomerCommand, OperatorCommand, Outcome, RailCommand, Treasury } from './contracts.js';

const sim = new Simulation(fixtureConfig());
const customer = sim.customer('fictionalCustomer');
const timeline: { step: string; outcome: Outcome; treasury: Treasury }[] = [];
async function step(label: string, lane: (c: unknown) => Promise<Outcome>, command: AgentCommand | CustomerCommand | OperatorCommand | RailCommand, expectOk = true): Promise<void> {
  const outcome = await lane(command);
  timeline.push({ step: label, outcome, treasury: sim.balance() });
  if (outcome.ok !== expectOk) throw Error(`${label}: unexpected ${outcome.code}`);
}
const agent = (c: unknown) => sim.agent(c);
const rail = (c: unknown) => sim.fakeRail(c);

await step('Discover eligible work from a fictional saved catalog', agent, { type: 'discover_work', requestId: 'discover', workId: 'packet' });
await step('Freeze scope, criteria, inputs, deadline and price before execution', agent, { type: 'scope_assignment', requestId: 'scope', workId: 'packet' });
await step('Accept frozen scope and hold the 150-unit cost ceiling', agent, { type: 'accept_assignment', requestId: 'assign', workId: 'packet' });
await step('Execute the saved-page comparison; actual provider cost is unknown', agent, { type: 'begin_work', requestId: 'execute', workId: 'packet' });
const packet = sim.snapshot().works.packet.execution!.output.content;
await step('Deliver a deterministic release-check packet', agent, { type: 'deliver_artifact', requestId: 'deliver', workId: 'packet', content: packet });
const work = sim.snapshot().works.packet;
const acceptance = { type: 'accept_delivery' as const, requestId: 'accept', workId: 'packet', artifactSha256: work.artifact!.sha256, scopeDigest: work.scopeDigest!, criteriaRevision: work.listing.criteriaRevision };
await step('Worker self-acceptance is refused', agent, acceptance, false);
await step('A distinct fictional customer accepts that artifact and criteria', customer, acceptance);
await step('Issue an invoice for accepted work', agent, { type: 'issue_invoice', requestId: 'invoice', workId: 'packet' });
await step('Observe 200 pending units; spendable balance does not increase', rail, { type: 'observe_earning', requestId: 'pending', invoiceId: 'invoice_packet', paymentId: 'paymentFirst', observation: observation('pendingReceipt', 1, 'PENDING', 200) });
await step('Observe the first 200 units settled; invoice remains partially paid', rail, { type: 'observe_earning', requestId: 'partial', invoiceId: 'invoice_packet', paymentId: 'paymentFirst', observation: observation('partialReceipt', 2, 'SETTLED', 200) });
await step('Observe remaining 300 units as unknown; exclude them from available', rail, { type: 'observe_earning', requestId: 'unknown', invoiceId: 'invoice_packet', paymentId: 'paymentRest', observation: observation('unknownReceipt', 1, 'UNKNOWN', 300) });
await step('Observe remaining 300 units settled', rail, { type: 'observe_earning', requestId: 'settled', invoiceId: 'invoice_packet', paymentId: 'paymentRest', observation: observation('settledReceipt', 2, 'SETTLED', 300) });
await step('Close unused work budget', agent, { type: 'close_commitment', requestId: 'close', workId: 'packet' });
await step('Customer opens a dispute', customer, { type: 'dispute_invoice', requestId: 'dispute', invoiceId: 'invoice_packet', reason: 'Fictional partial service adjustment' });
await step('Customer requests a 100-unit refund; record a liability immediately', customer, { type: 'request_refund', requestId: 'refundRequest', invoiceId: 'invoice_packet', amount: 100, reason: 'Fictional adjustment' });
await step('Begin a fake refund', agent, { type: 'begin_refund', requestId: 'refundStart', invoiceId: 'invoice_packet', attemptId: 'refundAttempt' });
await step('Unknown refund keeps the full obligation held', rail, { type: 'observe_refund', requestId: 'refundUnknown', attemptId: 'refundAttempt', observation: observation('refundUnknownReceipt', 1, 'UNKNOWN', 100) });
await step('Observed fake refund settlement clears the obligation', rail, { type: 'observe_refund', requestId: 'refundSettled', attemptId: 'refundAttempt', observation: observation('refundSettledReceipt', 2, 'SETTLED', 100) });
await step('Fictional customer resolves the dispute', customer, { type: 'resolve_dispute', requestId: 'resolve', invoiceId: 'invoice_packet' });

// Independent arithmetic fixture: opening 1000 - reserve 200 - held 150 - spend 300 = 350.
const arithmetic = new Simulation(fixtureConfig());
for (const workId of ['commitment', 'spent']) {
  await arithmetic.agent({ type: 'discover_work', requestId: `discover_${workId}`, workId });
  await arithmetic.agent({ type: 'scope_assignment', requestId: `scope_${workId}`, workId });
  await arithmetic.agent({ type: 'accept_assignment', requestId: `assign_${workId}`, workId });
}
await arithmetic.agent({ type: 'begin_spend', requestId: 'startSpend', workId: 'spent', attemptId: 'fakeSpend', amount: 300 });
await arithmetic.fakeRail({ type: 'observe_spend', requestId: 'settleSpend', attemptId: 'fakeSpend', observation: observation('spendReceipt', 1, 'SETTLED', 300) });
if (arithmetic.balance().available !== 350) throw Error('Arithmetic fixture failed');
const auditBundle = sim.exportAudit();
const replay = await Simulation.replay(auditBundle, auditBundle.head);
if (!replay.valid) throw Error(replay.code);
const output = { notice: 'OFFLINE SIMULATION. All actors, units, receipts and time are fictional. No money or network activity.', identity: sim.identity(), timeline, artifactContent: packet, finalState: sim.snapshot(), treasury: sim.balance(), arithmeticFixture: arithmetic.balance(), auditBundle, replay };
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
else {
  console.log(output.notice);
  console.log(`${output.identity.id}: ${output.identity.disclosure}`);
  console.log(`Requested model: ${output.identity.requestedModel}; observed model: unknown.`);
  for (const [i, row] of timeline.entries()) console.log(`${i + 1}. ${row.step}\n   ${row.outcome.code}; available ${row.treasury.available}; pending ${row.treasury.pendingEarnings}; uncertain ${row.treasury.uncertainEarnings}; held ${row.treasury.commitments}; obligations ${row.treasury.obligations}`);
  console.log(`Arithmetic fixture: 1000 - 200 reserve - 150 commitment - 300 settled spend = ${output.arithmeticFixture.available} FAKE_CREDIT.`);
  console.log(`Replay: ${replay.code}, ${replay.eventCount} events; authenticity UNSIGNED; underlying action truth NOT_ESTABLISHED.`);
  console.log(`Audit head: ${auditBundle.head}`);
}
