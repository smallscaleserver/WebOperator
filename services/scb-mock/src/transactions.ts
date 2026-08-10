export interface Transaction {
  date: string; // DD/MM/YYYY
  time: string; // HH:MM
  trCode: string;
  description: string;
  amount: number; // positive = credit, negative = debit
  channel: string;
  chequeNo: string;
  terminalNo: string;
  tellerNo: string;
  branchCode: string;
}

const MOCK_COUNTERPARTIES = ["บริษัท มายมอค จำกัด", "ร้านทดสอบ ABC", "MOCK VENDOR CO"];
const MOCK_DESCRIPTIONS_DEBIT = ["จ่ายบิล มายมอคเทสต์", "ชำระค่าสินค้า MOCK"];
const MOCK_DESCRIPTIONS_CREDIT = ["รับโอนจาก MOCK x0001", "รับเงินจาก บริษัท มายมอค จำกัด"];

// Same self-contained seeded PRNG as xc-bank's transactions.ts
// (mulberry32) -- deterministic per seed, no dependency needed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): { date: string; time: string } {
  return {
    date: `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

// Deterministic per (sessionId, company) so switching company shows
// genuinely different transactions, matching real multi-company
// behavior -- same idea as xc-bank's per-session seeding.
export function generateBaselineTransactions(sessionId: string, company: string): Transaction[] {
  const seed = hashSeed(`${sessionId}:${company}`);
  const rand = mulberry32(seed);
  const count = 4 + Math.floor(rand() * 3); // 4-6 rows
  const transactions: Transaction[] = [];
  let minutesAgo = count * (20 + Math.floor(rand() * 60));

  for (let i = 0; i < count; i++) {
    const isCredit = rand() > 0.5;
    const amount = Math.round((50 + rand() * 950) * 100) / 100;
    const description = isCredit
      ? MOCK_DESCRIPTIONS_CREDIT[Math.floor(rand() * MOCK_DESCRIPTIONS_CREDIT.length)]
      : MOCK_DESCRIPTIONS_DEBIT[Math.floor(rand() * MOCK_DESCRIPTIONS_DEBIT.length)];
    minutesAgo = Math.max(0, minutesAgo - (20 + Math.floor(rand() * 60)));
    const { date, time } = formatDate(new Date(Date.now() - minutesAgo * 60_000));

    transactions.push({
      date,
      time,
      trCode: isCredit ? "X1" : "X2",
      description,
      amount: isCredit ? amount : -amount,
      channel: "MOCK",
      chequeNo: "0000000000",
      terminalNo: "",
      tellerNo: `MOCK${1000 + Math.floor(rand() * 9000)}`,
      branchCode: "0000",
    });
  }

  // Most recent first, matching the real page.
  transactions.reverse();
  return transactions;
}

export function computeBalances(transactions: Transaction[]): { available: number; ledger: number } {
  const total = transactions.reduce((sum, t) => sum + t.amount, 1_000);
  const rounded = Math.round(total * 100) / 100;
  return { available: rounded, ledger: rounded };
}

export function makeManualTransaction(direction: "credit" | "debit", amount: number, description?: string): Transaction {
  const { date, time } = formatDate(new Date());
  return {
    date,
    time,
    trCode: direction === "credit" ? "X1" : "X2",
    description: description || (direction === "credit" ? "รับโอนจาก MOCK (dev-injected)" : "จ่ายบิล MOCK (dev-injected)"),
    amount: direction === "credit" ? Math.abs(amount) : -Math.abs(amount),
    channel: "MOCK",
    chequeNo: "0000000000",
    terminalNo: "",
    tellerNo: "MOCKDEV",
    branchCode: "0000",
  };
}
