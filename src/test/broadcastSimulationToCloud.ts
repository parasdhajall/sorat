import { getUsers, CLOUD_ACCOUNTS_SYNC_TOPIC } from "../lib/userStore";

export async function broadcastLiveRamuSnapshot() {
  const users = getUsers();
  const payload = users.map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    phone: u.phone,
    pin: u.pin || "1212",
    agentCode: u.agentCode,
    balance: u.balance,
    balanceUpdatedAt: Date.now(),
    totalDeposited: u.totalDeposited,
    status: u.status,
    deposits: u.deposits,
    bets: (u.bets || []).slice(0, 30),
  }));

  const res = await fetch(`https://ntfy.sh/${CLOUD_ACCOUNTS_SYNC_TOPIC}`, {
    method: "POST",
    headers: { Title: "ACCOUNTS_SYNC" },
    body: JSON.stringify({
      type: "ACCOUNTS_SYNC",
      users: payload,
      ts: Date.now(),
    }),
  });

  console.log("Broadcast status:", res.status, res.statusText);
  return res.ok;
}
