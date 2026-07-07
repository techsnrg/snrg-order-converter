type UpstashConfig = {
  url: string;
  token: string;
};

type UpstashResponse<T> = {
  result?: T;
  error?: string;
};

function getUpstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return { url, token };
}

export function isUpstashConfigured() {
  return Boolean(getUpstashConfig());
}

export async function upstashCommand<T>(command: Array<string | number>) {
  const config = getUpstashConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });

  const payload = (await response.json()) as UpstashResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Upstash command failed: ${response.status}`);
  }

  return payload.result as T;
}

export async function upstashPipeline<T>(commands: Array<Array<string | number>>) {
  const config = getUpstashConfig();
  if (!config) return null;

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands),
    cache: "no-store"
  });

  const payload = (await response.json()) as Array<UpstashResponse<T>>;

  if (!response.ok) {
    throw new Error(`Upstash pipeline failed: ${response.status}`);
  }

  const failed = payload.find((result) => result.error);
  if (failed?.error) {
    throw new Error(failed.error);
  }

  return payload.map((result) => result.result as T);
}
