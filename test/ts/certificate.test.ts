import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { createReceipt, verifyReceipt } from "../../src/core/receipt.js";
import { ProofSigner } from "../../src/core/signer.js";
import { generateHtmlCertificate } from "../../src/visual/badge.js";

const copyFallback =
  "Clipboard is unavailable. The Merkle root is selected; use your device’s Copy command.";

async function certificate() {
  const receipt = await createReceipt({
    task: { name: "Certificate release", status: "FAILURE", exitCode: 1 },
    artifacts: [{ path: "release/bundle.tar.gz", data: "release artifact" }],
    signingKey: ProofSigner.generateSecretKey(),
    signerIdentity: "release-gate",
  });
  return { receipt, html: generateHtmlCertificate(receipt) };
}

function executableScript(html: string): string {
  const scripts = [...html.matchAll(/<script>\s*([\s\S]*?)\s*<\/script>/g)];
  assert.equal(scripts.length, 1, "certificate has one static interaction script");
  return scripts[0]![1]!;
}

type Listener = () => void | Promise<void>;

class MockElement {
  hidden = false;
  disabled = false;
  value = "";
  textContent = "";
  focused = false;
  selected = false;
  private listeners = new Map<string, Listener>();

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener);
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  dispatch(name: string): void | Promise<void> {
    const listener = this.listeners.get(name);
    assert.ok(listener, `a ${name} handler is registered`);
    return listener();
  }
}

function runInteractions(html: string, rootValue: string, navigatorValue?: unknown) {
  const root = new MockElement();
  root.value = rootValue;
  const actions = new MockElement();
  actions.hidden = true;
  const copy = new MockElement();
  const print = new MockElement();
  const status = new MockElement();
  const statusMarkup = html.match(/<p\b[^>]*id="copy-status"[^>]*>([^<]*)<\/p>/);
  assert.ok(statusMarkup);
  status.textContent = statusMarkup[1]!;
  const elements = new Map([
    ["merkle-root", root],
    ["certificate-actions", actions],
    ["copy-root-button", copy],
    ["print-certificate-button", print],
    ["copy-status", status],
  ]);
  let printed = 0;
  const context: Record<string, unknown> = {
    document: { getElementById: (id: string) => elements.get(id) ?? null },
    window: { print: () => { printed += 1; } },
  };
  if (navigatorValue !== undefined) context["navigator"] = navigatorValue;
  runInNewContext(executableScript(html), context, { timeout: 1000 });
  return { root, actions, copy, print, status, printCount: () => printed };
}

function attribute(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

describe("Standalone certificate experience", () => {
  it("provides landmarks, selectable proof data, and a named keyboard-scrollable artifact table", async () => {
    const { receipt, html } = await certificate();
    assert.match(html, /<main\b[^>]*>/);
    assert.match(html, /<h1\b[^>]*>NYMREL PROOF LEDGER<\/h1>/);
    assert.equal([...html.matchAll(/<h2\b/g)].length, 4);
    const root = html.match(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/);
    assert.ok(root);
    assert.equal(attribute(root[1]!, "id"), "merkle-root");
    assert.match(root[1]!, /\breadonly(?:\s|=|$)/);
    assert.equal(root[2], receipt.merkle.root);
    assert.match(html, /<label\b[^>]*for="merkle-root"[^>]*>[^<]+<\/label>/);

    const tableRegion = html.match(/<div\b([^>]*class="[^"]*\btable-scroll\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/);
    assert.ok(tableRegion);
    assert.equal(attribute(tableRegion[1]!, "tabindex"), "0");
    const name = attribute(tableRegion[1]!, "aria-label");
    const labelledBy = attribute(tableRegion[1]!, "aria-labelledby");
    assert.ok(name || labelledBy, "scroll region has an accessible name");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        assert.ok(html.includes(`id="${id}"`), "accessible name references existing content");
      }
    }
    assert.match(tableRegion[2]!, /<caption\b[^>]*>[^<]+<\/caption>/);
    const headings = [...tableRegion[2]!.matchAll(/<th\b([^>]*)>/g)];
    assert.equal(headings.length, 3);
    assert.ok(headings.every((heading) => attribute(heading[1]!, "scope") === "col"));
    assert.ok(tableRegion[2]!.includes("release/bundle.tar.gz"));
  });

  it("keeps actions hidden without scripts and exposes copy feedback to assistive technology", async () => {
    const { html } = await certificate();
    const actions = html.match(/<div\b([^>]*id="certificate-actions"[^>]*)>/);
    assert.ok(actions);
    assert.match(actions[1]!, /\bhidden(?:\s|=|$)/);
    for (const id of ["copy-root-button", "print-certificate-button"]) {
      const button = html.match(new RegExp(`<button\\b([^>]*id="${id}"[^>]*)>`));
      assert.ok(button);
      assert.equal(attribute(button[1]!, "type"), "button");
    }
    const status = html.match(/<[^>]+\bid="copy-status"[^>]*>/);
    assert.ok(status);
    assert.equal(attribute(status[0], "role"), "status");
    assert.doesNotMatch(html, /\bonclick\s*=/i);
  });

  it("makes an artifact-free receipt understandable while retaining its proof root", async () => {
    const receipt = await createReceipt({
      task: { name: "Context-only task" },
      signingKey: ProofSigner.generateSecretKey(),
      signerIdentity: "release-gate",
    });
    const html = generateHtmlCertificate(receipt);
    assert.match(html, /<td\b[^>]*colspan="3"[^>]*>[^<]*No artifacts[^<]*<\/td>/i);
    assert.ok(html.includes(receipt.merkle.root));
    assert.match(html, /<textarea\b[^>]*id="merkle-root"/);
  });

  it("accepts optional null Git context and displays standalone lineage", async () => {
    const { receipt } = await certificate();
    const nullableReceipt = {
      ...receipt,
      environment: { ...receipt.environment, git: null },
    } as unknown as typeof receipt;
    const html = generateHtmlCertificate(nullableReceipt);
    assert.ok(html.includes("Git Lineage"));
    assert.ok(html.includes("standalone @ n/a"));
    assert.ok(html.includes("release-gate (HMAC-SHA256)"));
  });

  it("keeps receipt data out of executable code and preserves safe JSON-LD", async () => {
    const attack = '</script><img src=x onerror="alert(1)">&\u2028\u2029';
    const receipt = await createReceipt({
      task: { name: attack },
      artifacts: [{ path: attack, data: "release artifact" }],
      signingKey: ProofSigner.generateSecretKey(),
      signerIdentity: attack,
    });
    const html = generateHtmlCertificate(receipt);
    assert.equal([...html.matchAll(/<\/script>/g)].length, 2);
    assert.doesNotMatch(html, /<img\b/);
    assert.ok(html.includes("&lt;/script&gt;&lt;img"));
    const { html: normalHtml } = await certificate();
    assert.equal(executableScript(html), executableScript(normalHtml));
    assert.ok(!executableScript(html).includes(receipt.merkle.root));
    assert.ok(!executableScript(html).includes(attack));
    const structuredData = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(structuredData);
    const metadata = JSON.parse(structuredData[1]!) as Record<string, unknown>;
    assert.equal(metadata["name"], `${attack} Attestation`);
    assert.equal(metadata["identifier"], receipt.proofId);
  });

  it("preserves receipt trust independently of task failure", async () => {
    const secret = ProofSigner.generateSecretKey();
    const receipt = await createReceipt({
      task: { name: "Expected failure", status: "FAILURE", exitCode: 1 },
      signingKey: secret,
      signerIdentity: "release-gate",
    });
    const integrityOnly = await verifyReceipt(receipt);
    const trusted = await verifyReceipt(receipt, {
      expectedAlgorithm: "HMAC-SHA256", publicKeyOrSecret: secret,
    });
    for (const [verification, label] of [
      [undefined, "UNVERIFIED RECEIPT"],
      [integrityOnly, "INTEGRITY ONLY"],
      [trusted, "TRUSTED RECEIPT"],
    ] as const) {
      const html = generateHtmlCertificate(receipt, { verification });
      assert.match(html, new RegExp(`<h2\\b[^>]*id="receipt-state-title"[^>]*>${label}<\\/h2>`));
      assert.ok(html.includes("FAILURE (Exit Code: 1)"));
      assert.ok(html.includes("use the original JSON and a key from a trusted source with an independently configured algorithm"));
      assert.ok(html.includes("Task status is a reported outcome; copying or printing does not verify it."));
    }
  });

  it("enables working actions and prints only in response to the print button", async () => {
    const { receipt, html } = await certificate();
    const page = runInteractions(html, receipt.merkle.root, {});
    assert.equal(page.actions.hidden, false);
    assert.equal(page.printCount(), 0);
    assert.equal(page.status.textContent, "You can also select and copy the Merkle root above.");
    await page.print.dispatch("click");
    assert.equal(page.printCount(), 1);
    assert.equal(page.status.textContent, "You can also select and copy the Merkle root above.");
  });

  it("waits for clipboard permission before claiming success and restores the copy button", async () => {
    const { receipt, html } = await certificate();
    let resolveCopy!: () => void;
    const pendingCopy = new Promise<void>((resolve) => { resolveCopy = resolve; });
    const copied: string[] = [];
    const page = runInteractions(html, receipt.merkle.root, {
      clipboard: { writeText: (value: string) => { copied.push(value); return pendingCopy; } },
    });
    const click = page.copy.dispatch("click");
    assert.deepEqual(copied, [receipt.merkle.root]);
    assert.equal(page.status.textContent, "Copying Merkle root…");
    assert.equal(page.copy.disabled, true);
    assert.equal(page.root.selected, false);
    resolveCopy();
    await click;
    assert.equal(page.status.textContent, "Merkle root copied.");
    assert.equal(page.copy.disabled, false);
    assert.equal(page.root.selected, false);
  });

  it("selects the root and gives a usable fallback when clipboard permission is rejected", async () => {
    const { receipt, html } = await certificate();
    let rejectCopy!: (error: Error) => void;
    const pendingCopy = new Promise<void>((_resolve, reject) => { rejectCopy = reject; });
    const page = runInteractions(html, receipt.merkle.root, {
      clipboard: { writeText: () => pendingCopy },
    });
    const click = page.copy.dispatch("click");
    assert.equal(page.status.textContent, "Copying Merkle root…");
    rejectCopy(new Error("Clipboard permission denied"));
    await click;
    assert.equal(page.root.focused, true);
    assert.equal(page.root.selected, true);
    assert.equal(page.root.value, receipt.merkle.root);
    assert.equal(page.status.textContent, copyFallback);
    assert.equal(page.copy.disabled, false);
  });

  it("handles absent clipboard APIs and synchronous clipboard failures without leaving a dead action", async () => {
    const { receipt, html } = await certificate();
    for (const navigatorValue of [
      undefined,
      {},
      { clipboard: {} },
      { clipboard: { writeText: () => { throw new Error("Clipboard unavailable"); } } },
    ]) {
      const page = runInteractions(html, receipt.merkle.root, navigatorValue);
      await page.copy.dispatch("click");
      assert.equal(page.root.focused, true);
      assert.equal(page.root.selected, true);
      assert.equal(page.status.textContent, copyFallback);
      assert.equal(page.copy.disabled, false);
      await page.print.dispatch("click");
      assert.equal(page.printCount(), 1);
    }
  });
});
