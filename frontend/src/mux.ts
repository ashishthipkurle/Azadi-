// Mux direct upload helper.
// Flow:
//   1. Ask backend for /api/media/upload-url (returns { upload_url, upload_id }).
//   2. PUT the file bytes to upload_url with the file's content type.
//   3. Poll GET /api/media/{upload_id} until Mux has a playback_id we can embed.
//
// The backend returns HTTP 503 when Mux keys are missing; callers catch that
// and show the "coming soon" toast.
import { apiGet, apiPost } from "@/src/api";

type PickedAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  type?: string | null;
};

type CreateResp = { upload_url: string; upload_id: string };
type MediaStatus = {
  upload_id: string;
  status: string;
  asset_id?: string;
  playback_id?: string;
};

export async function uploadToMux(
  asset: PickedAsset,
  onProgress?: (phase: "uploading" | "processing" | "ready") => void,
): Promise<MediaStatus> {
  const filename = asset.fileName || `dispatch-${Date.now()}`;
  const contentType = asset.mimeType || asset.type || "application/octet-stream";
  onProgress?.("uploading");

  const { upload_url, upload_id } = await apiPost<CreateResp>("/media/upload-url", {
    filename,
    content_type: contentType,
  });

  const fileRes = await fetch(asset.uri);
  const blob = await fileRes.blob();
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload rejected (${put.status})`);

  onProgress?.("processing");
  // Poll for asset readiness — 45 x 2s ~= 90s max.
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await apiGet<MediaStatus>(`/media/${upload_id}`);
    if (status.playback_id) {
      onProgress?.("ready");
      return status;
    }
  }
  return { upload_id, status: "processing" };
}
