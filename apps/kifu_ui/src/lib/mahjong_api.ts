import type { Seat, TileStr } from "../ui/types";

const apiBaseFromEnv = (import.meta.env.VITE_MAHJONG_API_BASE ?? "").trim();
export const MAHJONG_API_BASE = (apiBaseFromEnv || "http://localhost:8000/analysis").replace(/\/+$/, "");

export type TenpaiResponse = {
  ok: boolean;
  status?: string;
  shanten?: number;
  waits?: TileStr[];
  error?: string;
};

export type ImageAnalyzeResponse = {
  ok: boolean;
  tiles?: TileStr[];
  raw?: string[];
  error?: string;
};

export type CaptureResponse = {
  ok: boolean;
  inference_seconds?: number;
  hand?: { tiles: TileStr[] };
  debug?: {
    image_size?: { width: number; height: number };
    raw_tiles?: string[];
  };
  error?: string;
};

export type MeldPayload = {
  kind: string;
  tiles: TileStr[];
  calledTile?: TileStr;
  calledFrom?: Seat;
  open?: boolean;
  [key: string]: unknown;
};

export type ScoreCost = {
  main: number;
  additional?: number;
  main_bonus?: number;
  additional_bonus?: number;
  kyoutaku_bonus?: number;
  total?: number;
  yaku_level?: string;
};

export type ScoreResult = {
  han: number;
  fu: number;
  cost: ScoreCost | null;
  yaku: string[];
  [key: string]: unknown;
};

export type ScoreResponse = {
  ok: boolean;
  error?: string;
  result?: ScoreResult;
  debug?: string[];
};

export type WinPayload = {
  hand: TileStr[];
  melds: MeldPayload[];
  winTile: TileStr;
  winType: "ron" | "tsumo";
  isClosed: boolean;
  riichi: boolean;
  ippatsu: boolean;
  is_rinshan?: boolean;
  is_chankan?: boolean;
  is_haitei?: boolean;
  is_houtei?: boolean;
  is_daburu_riichi?: boolean;
  is_nagashi_mangan?: boolean;
  is_tenhou?: boolean;
  is_renhou?: boolean;
  is_chiihou?: boolean;
  is_open_riichi?: boolean;
  paarenchan?: number;
  roundWind: Seat;
  seatWind: Seat;
  doraIndicators: TileStr[];
  uraDoraIndicators: TileStr[];
  honba: number;
  riichiSticks: number;
  dealer: boolean;
  kiriage?: boolean;
  menzenTsumo?: boolean;
  debug?: boolean;
};

const postJson = async <T = unknown>(path: string, payload: unknown, timeoutMs?: number): Promise<T> => {
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${MAHJONG_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller?.signal
    });
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const postTenpai = (hand: TileStr[], melds: MeldPayload[] = [], timeoutMs = 5000): Promise<TenpaiResponse> =>
  postJson<TenpaiResponse>("/tenpai", { hand, melds }, timeoutMs);

export const scoreWin = (payload: WinPayload): Promise<ScoreResponse> =>
  postJson<ScoreResponse>("/hand", payload);

export const analyzeTilesFromImage = async (file: File, timeoutMs = 60000): Promise<ImageAnalyzeResponse> => {
  const form = new FormData();
  form.append("image", file);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${MAHJONG_API_BASE}/tiles-from-image`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    return (await res.json()) as ImageAnalyzeResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("画像解析がタイムアウトしました");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const captureTilesFromImage = async (blob: Blob, timeoutMs = 60000): Promise<CaptureResponse> => {
  const form = new FormData();
  const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
  form.append("file", file);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/capture", {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    return (await res.json()) as CaptureResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("画像解析がタイムアウトしました");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};
