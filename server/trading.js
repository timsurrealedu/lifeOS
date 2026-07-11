// Freqtrade analytics - read-only summary from the Oracle aiTrading box.
import spawn from 'cross-spawn';
import { loadConfig } from './config.js';

const DEFAULTS = {
  host: 'ubuntu@100.112.185.21',
  key: 'C:\\Users\\timsurreal\\Downloads\\ssh-key-2026-07-02.key',
  dir: '/home/ubuntu/aiTrading',
};
const box = () => ({ ...DEFAULTS, ...(loadConfig().trading || {}) });

function spawnBox(cmd) {
  const { host, key } = box();
  return host === 'local'
    ? spawn('sh', ['-c', cmd])
    : spawn('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, cmd]);
}

function ssh(cmd, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnBox(cmd);
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('trading box timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `ssh exit ${code}`).trim().slice(0, 400)));
    });
  });
}

export async function tradingSummary() {
  const { dir } = box();
  const py = `
import base64, json, re, urllib.request, urllib.error
from pathlib import Path

root = Path(${JSON.stringify(dir)})
report = (root / "report" / "weekly-report.sh").read_text()
api = re.search(r'^API="([^"]+)"', report, re.M).group(1)
user = re.search(r'^USER="([^"]+)"', report, re.M).group(1)
password = re.search(r'^PASS="([^"]+)"', report, re.M).group(1)

def req(path, token=None, method="GET"):
    url = api + "/" + path.lstrip("/")
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    else:
        raw = ("%s:%s" % (user, password)).encode()
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
    r = urllib.request.Request(url, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=8) as res:
        return json.loads(res.read().decode())

token = req("token/login", method="POST").get("access_token")
profit = req("profit", token)
balance = req("balance", token)
status = req("status", token)
trades = req("trades?limit=200", token).get("trades", [])

closed = [t for t in trades if not t.get("is_open")]
wins = int(profit.get("winning_trades") or sum(1 for t in closed if (t.get("profit_ratio") or 0) > 0))
losses = int(profit.get("losing_trades") or sum(1 for t in closed if (t.get("profit_ratio") or 0) < 0))
total_closed = wins + losses
win_rate = (wins / total_closed * 100) if total_closed else 0
total = balance.get("total") or balance.get("total_est_stake") or {}
stake = balance.get("stake") or balance.get("stake_currency") or "USDT"
balance_value = total.get(stake) if isinstance(total, dict) else total
if balance_value is None:
    currencies = balance.get("currencies") or []
    balance_value = sum(float(c.get("est_stake") or 0) for c in currencies)

ordered_closed = sorted(closed, key=lambda x: x.get("close_date") or x.get("open_date") or "")[-40:]
total_abs = sum(float(t.get("profit_abs") or t.get("close_profit_abs") or 0) for t in ordered_closed)
running_balance = float(balance_value or 0) - total_abs
snapshots = []
for t in ordered_closed:
    trade_profit = float(t.get("profit_abs") or t.get("close_profit_abs") or 0)
    running_balance += trade_profit
    snapshots.append({
        "id": t.get("trade_id") or t.get("id"),
        "date": (t.get("close_date") or t.get("open_date") or "")[:10],
        "balance": running_balance,
        "pnl": (float(t.get("profit_ratio") or 0) * 100),
        "winRate": win_rate,
        "openTrades": len(status),
    })
if not snapshots:
    snapshots.append({
        "id": "live",
        "date": "",
        "balance": balance_value,
        "pnl": float(profit.get("profit_total") or profit.get("profit_closed_percent") or 0),
        "winRate": win_rate,
        "openTrades": len(status),
    })

positions = [{
    "id": str(t.get("trade_id") or t.get("id") or t.get("pair")),
    "pair": t.get("pair") or "Unknown",
    "side": "Short" if t.get("is_short") else "Long",
    "pnl": float(t.get("profit_ratio") or 0) * 100,
    "openRate": t.get("open_rate"),
    "openDate": t.get("open_date"),
} for t in status]

print(json.dumps({
    "source": "freqtrade",
    "status": "live",
    "stake": stake,
    "updatedAt": "",
    "profit": profit,
    "balance": balance,
    "snapshots": snapshots,
    "positions": positions,
}))
`.trim();
  return JSON.parse(await ssh(`python3 - <<'PY'\n${py}\nPY`, { timeoutMs: 45000 }));
}
