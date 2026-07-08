/**
 * Visual/UX patrol — auto-open a kanban card (with screenshot) per NEW finding.
 *
 * Flow (all endpoints verified against EClaw-plazacta backend source):
 *   1. POST /api/files/upload      (multipart "file")  -> { fileId }   [files.js:166]
 *   2. POST /api/mission/card                          -> { card.id }  [ECLAW_API §101]
 *   3. POST /api/mission/card/:id/file  { fileId }     attach shot     [kanban.js:2583]
 *
 * The card body embeds a `[patrol-sig]: <signature>` marker so the NEXT patrol
 * run recovers the signature via dedup.extractSignatures and never re-files it.
 *
 * The URL + payload builders are pure and unit-tested. The network calls are a
 * thin, injectable `fetch` so tests can assert requests without hitting prod.
 */

import type { Finding } from "./visual-detector.ts";
import { signatureMarkerLine } from "./dedup.ts";

export interface PatrolAuth {
  apiBase: string; // e.g. "https://eclawbot.com"
  deviceId: string;
  botSecret: string;
  entityId: number;
}

export interface CardDraft {
  title: string;
  description: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: "backlog" | "todo";
  assignedBots: number[];
  /** The signature this card covers (for dedup + traceability). */
  signature: string;
}

const DEFECT_LABEL: Record<Finding["defectClass"], string> = {
  fallback_avatar: "Fallback 頭像",
  horizontal_overflow: "橫向溢出",
  wrong_entity_avatar: "顯示錯實體",
  broken_image: "破圖",
  text_overflow: "文字溢出",
  empty_placeholder: "空占位遮蔽失敗",
};

/**
 * Turn a finding into a card draft. Pure — no network. The title starts with
 * a stable `[Auto][視覺巡檢]` tag so these cards are recognizable/filterable,
 * and the body carries the machine-readable signature marker for dedup.
 */
export function findingToCardDraft(finding: Finding): CardDraft {
  const label = DEFECT_LABEL[finding.defectClass];
  const vp = `${finding.viewport.width}x${finding.viewport.height}`;
  const title = `[Auto][視覺巡檢] ${finding.surface} — ${label} (${vp})`;
  const description = [
    `## 視覺/UX 巡檢自動偵測`,
    ``,
    `- **Surface**: ${finding.surface}`,
    `- **Viewport**: ${vp}`,
    `- **Defect class**: ${finding.defectClass} (${label})`,
    `- **Selector**: \`${finding.selector}\``,
    ``,
    `### Evidence`,
    finding.evidence,
    ``,
    `截圖見附件。此卡由常態視覺巡檢 cron 自動開立(根治「等 Hank 發現」)。`,
    `修復後移到 done;若同缺陷再現、巡檢會重開一張新卡。`,
    ``,
    signatureMarkerLine(finding.signature),
  ].join("\n");

  return {
    title,
    description,
    priority: "P2",
    status: "todo",
    assignedBots: [2],
    signature: finding.signature,
  };
}

/** Build the POST /api/mission/card request (url + JSON body). Pure. */
export function buildCreateCardRequest(auth: PatrolAuth, draft: CardDraft) {
  return {
    url: `${auth.apiBase}/api/mission/card`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: auth.deviceId,
      entityId: auth.entityId,
      botSecret: auth.botSecret,
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      status: draft.status,
      assignedBots: draft.assignedBots,
    }),
  };
}

/** Build the POST /api/mission/card/:id/file attach request. Pure. */
export function buildAttachFileRequest(auth: PatrolAuth, cardId: string, fileId: string) {
  return {
    url: `${auth.apiBase}/api/mission/card/${cardId}/file`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: auth.deviceId,
      entityId: auth.entityId,
      botSecret: auth.botSecret,
      fileId,
    }),
  };
}

/** Build the multipart upload for a screenshot. Pure (returns FormData). */
export function buildScreenshotUpload(
  auth: PatrolAuth,
  filename: string,
  screenshot: Uint8Array | Blob,
): { url: string; form: FormData } {
  const form = new FormData();
  form.append("deviceId", auth.deviceId);
  form.append("botSecret", auth.botSecret);
  form.append("entityId", String(auth.entityId));
  const blob = screenshot instanceof Blob ? screenshot : new Blob([screenshot], { type: "image/png" });
  form.append("file", blob, filename);
  return { url: `${auth.apiBase}/api/files/upload`, form };
}

/** Injectable fetch so tests never hit the network. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormData;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpenedCard {
  signature: string;
  cardId: string | null;
  screenshotAttached: boolean;
  error?: string;
}

/**
 * Open one card for a finding, uploading + attaching the screenshot if given.
 * Non-throwing: returns an OpenedCard with an error string on failure so a
 * single bad finding never aborts the whole patrol run.
 */
export async function openCardForFinding(
  auth: PatrolAuth,
  finding: Finding,
  screenshot: Uint8Array | Blob | null,
  fetchImpl: FetchLike,
): Promise<OpenedCard> {
  const draft = findingToCardDraft(finding);
  try {
    const createReq = buildCreateCardRequest(auth, draft);
    const createRes = await fetchImpl(createReq.url, createReq);
    if (!createRes.ok) {
      return { signature: finding.signature, cardId: null, screenshotAttached: false, error: `create HTTP ${createRes.status}` };
    }
    const created = (await createRes.json()) as { card?: { id?: string } };
    const cardId = created?.card?.id ?? null;
    if (!cardId) {
      return { signature: finding.signature, cardId: null, screenshotAttached: false, error: "no card id in response" };
    }

    let screenshotAttached = false;
    if (screenshot) {
      const filename = `patrol-${finding.surface}-${finding.defectClass}-${finding.viewport.width}x${finding.viewport.height}.png`;
      const { url: upUrl, form } = buildScreenshotUpload(auth, filename, screenshot);
      const upRes = await fetchImpl(upUrl, { method: "POST", body: form });
      if (upRes.ok) {
        const up = (await upRes.json()) as { fileId?: string };
        if (up?.fileId) {
          const attachReq = buildAttachFileRequest(auth, cardId, up.fileId);
          const attachRes = await fetchImpl(attachReq.url, attachReq);
          screenshotAttached = attachRes.ok;
        }
      }
    }
    return { signature: finding.signature, cardId, screenshotAttached };
  } catch (err) {
    return {
      signature: finding.signature,
      cardId: null,
      screenshotAttached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
