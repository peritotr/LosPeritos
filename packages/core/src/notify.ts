/**
 * A nudge to the user's phone when something waits for them, through an ntfy
 * server (ntfy.sh, or one of their own). Only the fact goes out: "a seal is
 * waiting". No project name, no text of the question, no address.
 */
import { randomBytes } from "node:crypto";
import type { NotifySettings } from "@losperitos/protocol";

export interface NotifyConfig {
  enabled: boolean;
  server: string;
  topic: string;
  lang: "en" | "tr";
}

const WORDS = {
  en: { seal: "A seal is waiting for you.", question: "A question is waiting for you.", test: "This is how LosPeritos will reach you." },
  tr: { seal: "Bir mühür seni bekliyor.", question: "Bir soru seni bekliyor.", test: "LosPeritos sana böyle ulaşacak." },
};
/** Several things raised at once make one nudge. */
const QUIET_MS = 20_000;

export class Notifier {
  private lastSent = 0;

  constructor(
    private readonly read: () => NotifyConfig | null,
    private readonly write: (config: NotifyConfig) => void,
    private readonly now: () => Date,
  ) {}

  settings(): NotifySettings {
    const config = this.read();
    return { enabled: !!config?.enabled, server: config?.server ?? "https://ntfy.sh", topic: config?.enabled ? config.topic : null };
  }

  set(request: { enabled: boolean; server?: string; renew?: boolean; lang?: "en" | "tr" }): NotifySettings {
    const before = this.read();
    const server = (request.server ?? before?.server ?? "https://ntfy.sh").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+/.test(server)) throw new Error("The server has to be an http(s) address.");
    this.write({
      enabled: request.enabled,
      server,
      // The topic is the only thing between a stranger and these nudges, so it is long and random.
      topic: !before || request.renew ? `losperitos-${randomBytes(12).toString("hex")}` : before.topic,
      lang: request.lang ?? before?.lang ?? "en",
    });
    return this.settings();
  }

  /** Tell the phone that something waits. Never throws: a nudge that fails must not hold the work up. */
  async nudge(kind: "seal" | "question" | "test"): Promise<boolean> {
    const config = this.read();
    if (!config?.enabled) return false;
    const at = this.now().getTime();
    if (kind !== "test" && at - this.lastSent < QUIET_MS) return false;
    if (kind !== "test") this.lastSent = at;
    try {
      const answer = await fetch(`${config.server}/${config.topic}`, {
        method: "POST",
        headers: { Title: "LosPeritos", Tags: kind === "question" ? "question" : "bell", "Content-Type": "text/plain; charset=utf-8" },
        body: WORDS[config.lang][kind],
        signal: AbortSignal.timeout(10_000),
      });
      return answer.ok;
    } catch {
      return false;
    }
  }
}
