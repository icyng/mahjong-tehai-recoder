import { useCallback, useEffect, useRef, useState } from "react";
import { captureTilesFromImage } from "../lib/mahjong_api";
import { formatSeatForLog } from "../lib/log_codec";
import type { ActionLogKind, Seat, TileStr } from "../ui/types";

const CAPTURE_MAX_EDGE = 1280;
const CAPTURE_JPEG_QUALITY = 0.85;

type UseScreenCaptureParams = {
  appendActionLog: (lines: string | string[], kind?: ActionLogKind) => void;
  applyDetectedTilesToSeat: (seat: Seat, tiles: TileStr[]) => void;
};

const calcCaptureTargetSize = (width: number, height: number) => {
  if (!width || !height) return { width: 0, height: 0 };
  const edge = Math.max(width, height);
  if (edge <= CAPTURE_MAX_EDGE) return { width, height };
  const scale = CAPTURE_MAX_EDGE / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};

const canvasToJpegBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("解析に失敗しました"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      CAPTURE_JPEG_QUALITY
    );
  });

export const useScreenCapture = ({
  appendActionLog,
  applyDetectedTilesToSeat
}: UseScreenCaptureParams) => {
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [captureStarting, setCaptureStarting] = useState(false);
  const [captureAnalyzing, setCaptureAnalyzing] = useState(false);

  const stopCaptureShare = useCallback(() => {
    if (!captureStream) return;
    captureStream.getTracks().forEach((track) => track.stop());
    setCaptureStream(null);
  }, [captureStream]);

  useEffect(() => {
    return () => {
      captureStream?.getTracks().forEach((track) => track.stop());
    };
  }, [captureStream]);

  useEffect(() => {
    const video = captureVideoRef.current;
    if (!video || !captureStream) return;
    video.srcObject = captureStream;
    void video.play().catch(() => undefined);
    const [track] = captureStream.getVideoTracks();
    const onEnded = () => {
      setCaptureStream(null);
    };
    track?.addEventListener("ended", onEnded);
    return () => {
      track?.removeEventListener("ended", onEnded);
    };
  }, [captureStream]);

  const startScreenCapture = useCallback(async () => {
    if (captureStarting || captureAnalyzing) return;
    if (captureStream) {
      stopCaptureShare();
      appendActionLog("画面共有終了", "system");
      return;
    }
    const mediaDevices = globalThis.navigator?.mediaDevices;
    const hasDisplayMedia = Boolean(mediaDevices && typeof mediaDevices.getDisplayMedia === "function");
    if (!hasDisplayMedia) {
      appendActionLog("画面共有に非対応の環境です（HTTPS または localhost で開いてください）", "error");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      appendActionLog("画面共有は安全な接続（HTTPS）でのみ利用できます", "error");
      return;
    }
    setCaptureStarting(true);
    try {
      const stream = await mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setCaptureStream(stream);
      appendActionLog("画面共有開始", "system");
    } catch (err) {
      const message = err instanceof Error ? err.message : "画面共有を開始できませんでした";
      appendActionLog(`画面共有: ${message}`, "error");
    } finally {
      setCaptureStarting(false);
    }
  }, [appendActionLog, captureAnalyzing, captureStarting, captureStream, stopCaptureShare]);

  const captureAndAnalyzeForSeat = useCallback(
    async (seat: Seat) => {
      if (!captureStream || captureAnalyzing) return;
      const video = captureVideoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        appendActionLog("画像解析: 映像が準備できていません", "error");
        return;
      }
      setCaptureAnalyzing(true);
      appendActionLog(`${formatSeatForLog(seat)}画像: 解析送信中...`, "system");
      try {
        const target = calcCaptureTargetSize(video.videoWidth, video.videoHeight);
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("キャンバス初期化に失敗しました");
        ctx.drawImage(video, 0, 0, target.width, target.height);
        const blob = await canvasToJpegBlob(canvas);
        const result = await captureTilesFromImage(blob);
        if (!result.ok) {
          throw new Error(result.error ?? "画像解析に失敗しました");
        }
        const tiles = result.hand?.tiles ?? [];
        applyDetectedTilesToSeat(seat, tiles);
        appendActionLog(`${formatSeatForLog(seat)}画像: 解析完了 (${tiles.length}枚)`, "system");
      } catch (err) {
        const message = err instanceof Error ? err.message : "画像解析に失敗しました";
        appendActionLog(`${formatSeatForLog(seat)}画像: ${message}`, "error");
      } finally {
        setCaptureAnalyzing(false);
      }
    },
    [appendActionLog, applyDetectedTilesToSeat, captureAnalyzing, captureStream]
  );

  return {
    captureVideoRef,
    captureStream,
    captureStarting,
    captureAnalyzing,
    startScreenCapture,
    captureAndAnalyzeForSeat
  };
};
