export interface Transaction {
  id: string;
  timestamp: string;
  direction: "credit" | "debit";
  amount: number;
  counterpartyName: string;
  counterpartyAccount: string;
  balanceAfter: number;
  // Design-only scaffolding for a *future* email-notification feature --
  // nothing reads or sends these this round. Kept here so a later round
  // can build a notification from a transaction without a schema change.
  notificationSubjectTemplate: string;
  notificationStatus: "mock-only";
}

export interface DashboardData {
  balance: number;
  transactions: Transaction[];
}

const COUNTERPARTIES: Array<{ name: string; account: string }> = [
  { name: "Alex Rivera", account: "XC-2291-8834" },
  { name: "Coffee & Co.", account: "XC-1187-2201" },
  { name: "Northgate Utilities", account: "XC-5502-9910" },
  { name: "Jordan Lee", account: "XC-7743-1120" },
  { name: "Metro Transit", account: "XC-0091-4477" },
  { name: "Sunrise Grocers", account: "XC-3320-6654" },
];

// Small self-contained seeded PRNG (mulberry32) -- deterministic given a
// seed, no dependency needed. Lets the dashboard change over time/on
// regenerate while still being reproducible within one seed for a human
// to sanity-check without a race against a fully random generator.
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

// Changes every 10s so a human refreshing manually sees stable data
// within one window, but two automated runs more than 10s apart (or
// after a /dev/regenerate bump) always see different data -- proves
// extraction reads the live page, not a cached/hard-coded snapshot.
const TIME_WINDOW_MS = 10_000;

export function generateDashboard(sessionId: string, regenerateEpoch: number): DashboardData {
  const timeWindow = Math.floor(Date.now() / TIME_WINDOW_MS);
  const seed = hashSeed(`${sessionId}:${regenerateEpoch}:${timeWindow}`);
  const rand = mulberry32(seed);

  let balance = 1_000 + rand() * 4_000;
  const count = 5 + Math.floor(rand() * 4); // 5-8 transactions
  const transactions: Transaction[] = [];

  // Generated oldest-first so `balance` accumulates forward through real
  // time and balanceAfter on the *last* (most recent) transaction always
  // equals the current balance shown at the top of the dashboard --
  // reversed for display only, after the running balance is settled.
  let minutesAgo = count * (5 + Math.floor(rand() * 40));
  for (let i = 0; i < count; i++) {
    const direction: Transaction["direction"] = rand() > 0.5 ? "credit" : "debit";
    const amount = Math.round((10 + rand() * 490) * 100) / 100;
    const counterparty = COUNTERPARTIES[Math.floor(rand() * COUNTERPARTIES.length)];
    balance = direction === "credit" ? balance + amount : balance - amount;
    balance = Math.round(balance * 100) / 100;

    minutesAgo = Math.max(0, minutesAgo - (5 + Math.floor(rand() * 40)));
    const timestamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();

    transactions.push({
      id: `TXN-${seed >>> 0}-${i}`,
      timestamp,
      direction,
      amount,
      counterpartyName: counterparty.name,
      counterpartyAccount: counterparty.account,
      balanceAfter: balance,
      notificationSubjectTemplate:
        direction === "credit" ? "You received a payment" : "Payment sent from your account",
      notificationStatus: "mock-only",
    });
  }

  // Most recent transaction first, matching a real bank dashboard.
  transactions.reverse();

  return { balance, transactions };
}
