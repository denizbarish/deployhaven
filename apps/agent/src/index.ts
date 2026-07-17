const API = process.env.DEPLOYHAVEN_API_URL ?? "http://localhost:4000";
const TOKEN = process.env.DEPLOYHAVEN_ENROLL_TOKEN;

async function main() {
  if (!TOKEN) throw new Error("DEPLOYHAVEN_ENROLL_TOKEN gerekli");
  const reg = await fetch(`${API}/agent/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  if (!reg.ok) throw new Error(`register başarısız: ${reg.status}`);
  console.log("agent kaydoldu");

  setInterval(async () => {
    await fetch(`${API}/agent/heartbeat`, {
      method: "POST",
      headers: { "x-agent-token": TOKEN },
    }).catch(() => {});
  }, 30000);
}

void main();
