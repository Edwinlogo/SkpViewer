import { unzipSync } from 'fflate';

export interface SkpSceneEntityLookup {
  /** Uppercase 32-char SketchUp instance GUID -> viewer nodeIds */
  guidToNodeIds: Map<string, string[]>;
  /** Lowercased instance name -> viewer nodeIds */
  nameToNodeIds: Map<string, string[]>;
}

export interface PageHiddenEntitiesResult {
  /** Page index -> list of viewer nodeIds hidden specifically in that scene */
  byPageIndex: Map<number, string[]>;
  /** Page name -> list of viewer nodeIds hidden specifically in that scene */
  byPageName: Map<string, string[]>;
  /** True if the file's page section was inspected successfully */
  detected: boolean;
}

interface FlatTlv {
  tag: number;
  payload: Uint8Array;
}

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
  );
}

function parseVarInt(buf: Uint8Array, off: number, len: number): number {
  let val = 0;
  let shift = 0;
  const end = Math.min(buf.length, off + len);
  for (let i = off; i < end; i++) {
    val += buf[i] * Math.pow(2, shift);
    shift += 8;
  }
  return val;
}

function parseTlvItems(buf: Uint8Array | null): FlatTlv[] | null {
  if (!buf || buf.length < 6) return null;
  const items: FlatTlv[] = [];
  let off = 0;
  while (off + 6 <= buf.length) {
    const tag = buf[off] | (buf[off + 1] << 8);
    const len = readU32LE(buf, off + 2);
    if (off + 6 + len > buf.length) break;
    items.push({ tag, payload: buf.subarray(off + 6, off + 6 + len) });
    off += 6 + len;
  }
  return items;
}

function findTlv(items: FlatTlv[] | null, tag: number): Uint8Array | null {
  if (!items) return null;
  for (const it of items) {
    if (it.tag === tag) return it.payload;
  }
  return null;
}

/**
 * Extracts length-prefixed varint IDs (same encoding as VFF tag 29008 hiddenLayerIds)
 * AND also inspects nested TLV sub-records (used by SketchUp 2020+ Hidden Objects instance paths).
 */
function extractEntityIdsFromPagePayload(payload: Uint8Array): number[] {
  const ids = new Set<number>();

  // Strategy A: Flat length-prefixed varints: [len][val bytes]...
  let off = 0;
  let flatCount = 0;
  while (off + 1 <= payload.length) {
    const ln = payload[off];
    if (ln === 0 || ln > 8 || off + 1 + ln > payload.length) {
      flatCount = -1;
      break;
    }
    const id = parseVarInt(payload, off + 1, ln);
    if (id > 0) ids.add(id);
    off += 1 + ln;
    flatCount++;
  }
  if (flatCount > 0 && off === payload.length) {
    return Array.from(ids);
  }

  // Strategy B: Nested TLV entries containing varint entity IDs (e.g. persistent ID paths)
  ids.clear();
  const nested = parseTlvItems(payload);
  if (nested && nested.length > 0) {
    const walkNested = (list: FlatTlv[], depth: number) => {
      if (depth > 4) return;
      for (const item of list) {
        const p = item.payload;
        if (p.length >= 1 && p.length <= 8) {
          const val = parseVarInt(p, 0, p.length);
          if (val > 0) ids.add(val);
        } else if (p.length >= 6) {
          // Try length-prefixed varints inside this sub-record
          let pOff = 0;
          let ok = true;
          const local: number[] = [];
          while (pOff + 1 <= p.length) {
            const ln = p[pOff];
            if (ln === 0 || ln > 8 || pOff + 1 + ln > p.length) {
              ok = false;
              break;
            }
            const v = parseVarInt(p, pOff + 1, ln);
            if (v > 0) local.push(v);
            pOff += 1 + ln;
          }
          if (ok && pOff === p.length && local.length > 0) {
            // In an instance path [parentId, ..., leafId], the leaf is the hidden target
            ids.add(local[local.length - 1]);
          } else {
            const sub = parseTlvItems(p);
            if (sub && sub.length > 0) walkNested(sub, depth + 1);
          }
        }
      }
    };
    walkNested(nested, 0);
  }

  return Array.from(ids);
}

function findZipStart(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 4, 2048);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      return i;
    }
  }
  return -1;
}

/**
 * Walks VFF model.dat to map every CComponentInstance / CGroup entity ID (tag 6419 -> D007 -> DC05 -> DE05)
 * to its GUID (tag 6819) and name (tag 6519), and reads per-page hidden entity tags (29007 / 29009 / etc.).
 */
function extractFromVff(bytes: Uint8Array, lookup: SkpSceneEntityLookup): PageHiddenEntitiesResult {
  const empty: PageHiddenEntitiesResult = {
    byPageIndex: new Map(),
    byPageName: new Map(),
    detected: false,
  };

  const zipStart = findZipStart(bytes);
  if (zipStart < 0) return empty;

  let modelData: Uint8Array | null = null;
  try {
    const unzipped = unzipSync(bytes.subarray(zipStart), {
      filter: (f) => {
        const lower = f.name.toLowerCase();
        return lower === 'model.dat' || lower.endsWith('/model.dat');
      },
    });
    for (const key of Object.keys(unzipped)) {
      modelData = unzipped[key];
      break;
    }
  } catch {
    return empty;
  }

  if (!modelData || modelData.length < 16) return empty;

  // 1. Walk TLV containers to collect entityId -> { guid, name } for instances (tag 0x1964 = 6500 LE -> bytes 0x64 0x19)
  // Note: openskp represents tag bytes [b0, b1] as hex string `${b0}${b1}`, so "6419" has u16 LE = 0x1964 (6500).
  const TAG_INSTANCE = 0x1964; // "6419"
  const TAG_GUID = 0x1968; // "6819"
  const TAG_NAME = 0x1965; // "6519"
  const TAG_DRAWBASE = 0x07d0; // "D007"
  const TAG_ENTITY = 0x05dc; // "DC05"
  const TAG_ENTITY_ID = 0x05de; // "DE05"
  const TAG_PAGES_ROOT = 0x0207; // "0702"

  const CONTAINER_SET = new Set<number>([
    0x01f4, // F401
    0x01f7, // F701
    0x30d4, // D430
    0x30d5, // D530
    0x32c8, // C832
    0x157c, // 7C15
    0x1388, // 8813
    0x1389, // 8913
    0x138a, // 8A13
    0x138b, // 8B13
    0x138c, // 8C13
    0x138d, // 8D13
    0x1d4c, // 4C1D
    0x1964, // 6419
    0x01f9, // F901
    0x07d0, // D007
    0x1771, // 7117
  ]);

  const entityIdToNodeIds = new Map<number, string[]>();
  let pagesPayload: Uint8Array | null = null;
  const decoder = new TextDecoder('utf-8');

  const extractEntityIdFromDrawbase = (drawbaseBytes: Uint8Array): number | null => {
    const dItems = parseTlvItems(drawbaseBytes);
    const dc05 = findTlv(dItems, TAG_ENTITY);
    if (!dc05) return null;
    if (dc05.length >= 6 && dc05[0] === 0xde && dc05[1] === 0x05) {
      const idLen = readU32LE(dc05, 2);
      if (6 + idLen <= dc05.length && idLen > 0 && idLen <= 8) {
        return parseVarInt(dc05, 6, idLen);
      }
    }
    const dcItems = parseTlvItems(dc05);
    const de05 = findTlv(dcItems, TAG_ENTITY_ID);
    if (de05 && de05.length > 0 && de05.length <= 8) {
      return parseVarInt(de05, 0, de05.length);
    }
    return null;
  };

  const walkTlv = (buf: Uint8Array, start: number, end: number, depth: number) => {
    if (depth > 18) return;
    let pos = start;
    while (pos + 6 <= end) {
      const tag = buf[pos] | (buf[pos + 1] << 8);
      const size = readU32LE(buf, pos + 2);
      if (pos + 6 + size > end) break;
      const bodyStart = pos + 6;
      const bodyEnd = bodyStart + size;

      if (tag === TAG_PAGES_ROOT && size > 0) {
        pagesPayload = buf.subarray(bodyStart, bodyEnd);
      } else if (tag === TAG_INSTANCE && size > 0) {
        const sub = parseTlvItems(buf.subarray(bodyStart, bodyEnd));
        if (sub) {
          const d007 = findTlv(sub, TAG_DRAWBASE);
          const entId = d007 ? extractEntityIdFromDrawbase(d007) : null;
          if (entId !== null && entId > 0) {
            const guidBytes = findTlv(sub, TAG_GUID);
            let matchedIds: string[] | undefined;
            if (guidBytes && guidBytes.length === 16) {
              let hex = '';
              for (let k = 0; k < 16; k++) {
                hex += guidBytes[k].toString(16).toUpperCase().padStart(2, '0');
              }
              matchedIds = lookup.guidToNodeIds.get(hex);
            }
            if (!matchedIds || matchedIds.length === 0) {
              const nameBytes = findTlv(sub, TAG_NAME);
              if (nameBytes && nameBytes.length > 0) {
                const nm = decoder.decode(nameBytes).replace(/\0/g, '').trim().toLowerCase();
                if (nm) matchedIds = lookup.nameToNodeIds.get(nm);
              }
            }
            if (matchedIds && matchedIds.length > 0) {
              entityIdToNodeIds.set(entId, matchedIds);
            }
          }
        }
      } else if (CONTAINER_SET.has(tag) && size > 0) {
        walkTlv(buf, bodyStart, bodyEnd, depth + 1);
      }

      pos = bodyEnd;
    }
  };

  walkTlv(modelData, 0, modelData.length, 0);

  if (!pagesPayload) return empty;

  const byPageIndex = new Map<number, string[]>();
  const byPageName = new Map<string, string[]>();
  let pageIndex = 0;

  const t60Items = parseTlvItems(pagesPayload);
  if (!t60Items) return empty;

  for (const it60 of t60Items) {
    if (it60.tag !== 28000) continue;
    const t61Items = parseTlvItems(it60.payload);
    if (!t61Items) continue;
    for (const it61 of t61Items) {
      if (it61.tag !== 28001) continue;
      const t48Items = parseTlvItems(it61.payload);
      if (!t48Items) continue;
      for (const it48 of t48Items) {
        if (it48.tag !== 29000) continue;
        const pageItems = parseTlvItems(it48.payload);
        if (!pageItems) continue;

        const head = parseTlvItems(findTlv(pageItems, 28500));
        const nameBytes = findTlv(head, 28501);
        const pageName = nameBytes ? decoder.decode(nameBytes).replace(/\0/g, '').trim() : '';

        // Inspect candidate hidden-entity tags in CViewPage VFF record:
        // 29007 = hidden entities (flag 0x10), 29009 / 29010 / 29011 = SketchUp 2020+ hidden objects / paths
        const candidateTags = [29007, 29009, 29010, 29011, 29012];
        const hiddenNodeIds = new Set<string>();

        for (const cTag of candidateTags) {
          const raw = findTlv(pageItems, cTag);
          if (!raw || raw.length === 0) continue;
          const entityIds = extractEntityIdsFromPagePayload(raw);
          for (const eid of entityIds) {
            const nodes = entityIdToNodeIds.get(eid);
            if (nodes) {
              for (const nid of nodes) hiddenNodeIds.add(nid);
            }
          }
        }

        const list = Array.from(hiddenNodeIds);
        byPageIndex.set(pageIndex, list);
        if (pageName) byPageName.set(pageName, list);
        pageIndex++;
      }
    }
  }

  return {
    byPageIndex,
    byPageName,
    detected: pageIndex > 0,
  };
}

/**
 * Extracts per-scene hidden elements from a SketchUp (.skp) binary buffer.
 * Currently supports modern VFF (SketchUp 2021+) files with full entity-ID -> GUID matching.
 */
export function extractSkpSceneHiddenEntities(
  buffer: ArrayBuffer,
  lookup: SkpSceneEntityLookup,
): PageHiddenEntitiesResult {
  try {
    const bytes = new Uint8Array(buffer);
    return extractFromVff(bytes, lookup);
  } catch {
    return {
      byPageIndex: new Map(),
      byPageName: new Map(),
      detected: false,
    };
  }
}
