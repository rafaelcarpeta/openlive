import { MsEdgeTTS, OUTPUT_FORMAT, type Voice } from "msedge-tts";

export interface EdgeVoice {
  id: string;
  name: string;
  locale: string;
  gender: string;
}

const VOICE_CACHE_MS = 6 * 60 * 60 * 1000;
const SYNTH_TIMEOUT_MS = 30_000;
let voiceCache: { at: number; voices: EdgeVoice[] } | null = null;

function normalizeVoice(v: Voice): EdgeVoice {
  const microsoftPrefix = /^Microsoft\s+/i;
  const onlineSuffix = /\s+Online \(Natural\).*$/i;
  const fallback = v.ShortName.replace(/^[a-z]{2}-[A-Z]{2}-/, "").replace(/Neural$/, "");
  return {
    id: v.ShortName,
    name: v.FriendlyName?.replace(microsoftPrefix, "").replace(onlineSuffix, "").trim() || fallback,
    locale: v.Locale,
    gender: v.Gender || "Unknown",
  };
}

export async function listEdgeVoices(): Promise<EdgeVoice[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS) return voiceCache.voices;
  const client = new MsEdgeTTS();
  try {
    const voices = (await client.getVoices())
      .filter((v) => v.ShortName && v.Locale)
      .map(normalizeVoice)
      .sort((a, b) => {
        const aPt = a.locale === "pt-BR" ? 0 : 1;
        const bPt = b.locale === "pt-BR" ? 0 : 1;
        return aPt - bPt || a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name);
      });
    if (!voices.length) throw new Error("Edge returned an empty voice catalog");
    voiceCache = { at: Date.now(), voices };
    return voices;
  } finally {
    client.close();
  }
}

function escapeSsml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function synthesizeEdge(
  text: string,
  voice: EdgeVoice,
  speed: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const client = new MsEdgeTTS();
  if (signal?.aborted) throw new DOMException("Edge synthesis aborted", "AbortError");

  try {
    await client.setMetadata(voice.id, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      voiceLocale: voice.locale,
    });
  } catch (e) {
    client.close();
    throw e;
  }
  if (signal?.aborted) {
    client.close();
    throw new DOMException("Edge synthesis aborted", "AbortError");
  }
  const { audioStream } = client.toStream(escapeSsml(text), { rate: speed });

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      client.close();
      if (error) reject(error);
      else {
        const audio = Buffer.concat(chunks);
        if (!audio.length) reject(new Error("Edge returned no audio"));
        else resolve(audio);
      }
    };
    const abort = () => {
      audioStream.destroy();
      finish(new DOMException("Edge synthesis aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      audioStream.destroy();
      finish(new Error(`Edge synthesis timed out after ${SYNTH_TIMEOUT_MS}ms`));
    }, SYNTH_TIMEOUT_MS);

    signal?.addEventListener("abort", abort, { once: true });
    audioStream.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    audioStream.once("end", () => finish());
    audioStream.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}
