/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type {
  Marker,
  MarkerIndex,
  Milliseconds,
  StartEndRange,
  ShredFrontierPayload,
  ShredGapPayload,
  ShredKind,
  ShredRecvRangePayload,
  ShredSource,
  ShredTurbineLayer,
} from 'firefox-profiler/types';

export type ShredRecvRange = Readonly<{
  markerIndex: MarkerIndex;
  time: Milliseconds;
  slot: number;
  startIndex: number;
  endIndex: number;
  source: ShredSource;
  shredKind: ShredKind;
  turbineLayer: ShredTurbineLayer | null;
}>;

export type ShredFrontierSample = Readonly<{
  markerIndex: MarkerIndex;
  time: Milliseconds;
  slot: number;
  highestReceived: number;
  consumed: number;
}>;

export type ShredGapEpisode = Readonly<{
  markerIndex: MarkerIndex;
  start: Milliseconds;
  end: Milliseconds;
  slot: number;
  startIndex: number;
  endIndex: number;
  width: number;
  lane: number;
}>;

export type PackedShredGapTrack = Readonly<{
  lanes: ReadonlyArray<ReadonlyArray<ShredGapEpisode>>;
  totalLaneCount: number;
}>;

export type ShredHeatmapSegment = Readonly<{
  slot: number;
  start: Milliseconds;
  end: Milliseconds;
  maxIndex: number;
  recvRanges: ReadonlyArray<ShredRecvRange>;
  frontierSamples: ReadonlyArray<ShredFrontierSample>;
  gapEpisodes: ReadonlyArray<ShredGapEpisode>;
}>;

export type PackedShredHeatmap = Readonly<{
  bands: ReadonlyArray<ReadonlyArray<ShredHeatmapSegment>>;
  totalBandCount: number;
}>;

function isShredRecvRangePayload(
  payload: Marker['data']
): payload is ShredRecvRangePayload {
  return payload !== null && payload.type === 'ShredRecvRange';
}

function isShredFrontierPayload(
  payload: Marker['data']
): payload is ShredFrontierPayload {
  return payload !== null && payload.type === 'ShredFrontier';
}

function isShredGapPayload(
  payload: Marker['data']
): payload is ShredGapPayload {
  return payload !== null && payload.type === 'ShredGap';
}

export function isShredMarker(marker: Marker): boolean {
  return (
    isShredRecvRangePayload(marker.data) ||
    isShredFrontierPayload(marker.data) ||
    isShredGapPayload(marker.data)
  );
}

export function collectShredRecvRanges(
  getMarker: (markerIndex: MarkerIndex) => Marker,
  markerIndexes: MarkerIndex[]
): ShredRecvRange[] {
  const recvRanges: ShredRecvRange[] = [];
  for (const markerIndex of markerIndexes) {
    const marker = getMarker(markerIndex);
    if (!isShredRecvRangePayload(marker.data)) {
      continue;
    }

    recvRanges.push({
      markerIndex,
      time: marker.start,
      slot: marker.data.slot,
      startIndex: marker.data.startIndex,
      endIndex: marker.data.endIndex,
      source: marker.data.source,
      shredKind: marker.data.shredKind,
      turbineLayer: marker.data.turbineLayer || null,
    });
  }

  recvRanges.sort((a, b) => a.time - b.time || a.slot - b.slot);
  return recvRanges;
}

export function collectShredFrontierSamples(
  getMarker: (markerIndex: MarkerIndex) => Marker,
  markerIndexes: MarkerIndex[]
): ShredFrontierSample[] {
  const frontierSamples: ShredFrontierSample[] = [];
  for (const markerIndex of markerIndexes) {
    const marker = getMarker(markerIndex);
    if (!isShredFrontierPayload(marker.data)) {
      continue;
    }

    frontierSamples.push({
      markerIndex,
      time: marker.start,
      slot: marker.data.slot,
      highestReceived: marker.data.highestReceived,
      consumed: marker.data.consumed,
    });
  }

  frontierSamples.sort((a, b) => a.time - b.time || a.slot - b.slot);
  return frontierSamples;
}

type PackedInterval = Readonly<{
  itemIndex: number;
  lane: number;
}>;

function packIntervalsByOverlap<
  T extends { start: Milliseconds; end: Milliseconds },
>(items: T[]): { packed: PackedInterval[]; totalLaneCount: number } {
  const sorted = items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .sort(
      (a, b) =>
        a.item.start - b.item.start ||
        a.item.end - b.item.end ||
        a.itemIndex - b.itemIndex
    );
  const laneEnds: Milliseconds[] = [];
  const packed: PackedInterval[] = [];

  for (const { item, itemIndex } of sorted) {
    let lane = 0;
    while (lane < laneEnds.length && item.start < laneEnds[lane]) {
      lane++;
    }
    if (lane === laneEnds.length) {
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    packed.push({ itemIndex, lane });
  }

  return { packed, totalLaneCount: laneEnds.length };
}

export function collectShredGapEpisodes(
  getMarker: (markerIndex: MarkerIndex) => Marker,
  markerIndexes: MarkerIndex[]
): PackedShredGapTrack {
  const gapMarkers: Array<{
    markerIndex: MarkerIndex;
    start: Milliseconds;
    end: Milliseconds;
    slot: number;
    startIndex: number;
    endIndex: number;
  }> = [];

  for (const markerIndex of markerIndexes) {
    const marker = getMarker(markerIndex);
    if (!isShredGapPayload(marker.data) || marker.end === null) {
      continue;
    }

    gapMarkers.push({
      markerIndex,
      start: marker.start,
      end: marker.end,
      slot: marker.data.slot,
      startIndex: marker.data.startIndex,
      endIndex: marker.data.endIndex,
    });
  }

  const { packed, totalLaneCount } = packIntervalsByOverlap(gapMarkers);
  const episodes: ShredGapEpisode[] = packed
    .map(({ itemIndex, lane }) => {
      const gapMarker = gapMarkers[itemIndex];
      return {
        markerIndex: gapMarker.markerIndex,
        start: gapMarker.start,
        end: gapMarker.end,
        slot: gapMarker.slot,
        startIndex: gapMarker.startIndex,
        endIndex: gapMarker.endIndex,
        width: gapMarker.endIndex - gapMarker.startIndex + 1,
        lane,
      };
    })
    .sort((a, b) => a.start - b.start || a.slot - b.slot);

  const lanes = Array.from(
    { length: totalLaneCount },
    () => [] as ShredGapEpisode[]
  );
  for (const episode of episodes) {
    lanes[episode.lane].push(episode);
  }

  return { lanes, totalLaneCount };
}

type MutableShredHeatmapSegment = {
  slot: number;
  start: Milliseconds;
  end: Milliseconds;
  maxIndex: number;
  recvRanges: ShredRecvRange[];
  frontierSamples: ShredFrontierSample[];
  gapEpisodes: ShredGapEpisode[];
};

export function buildShredHeatmap(
  recvRanges: ShredRecvRange[],
  frontierSamples: ShredFrontierSample[],
  gapTrack: PackedShredGapTrack,
  range: StartEndRange
): PackedShredHeatmap {
  const segmentsBySlot = new Map<number, MutableShredHeatmapSegment>();

  const getOrCreateSegment = (slot: number): MutableShredHeatmapSegment => {
    const existing = segmentsBySlot.get(slot);
    if (existing) {
      return existing;
    }
    const segment: MutableShredHeatmapSegment = {
      slot,
      start: Number.POSITIVE_INFINITY,
      end: Number.NEGATIVE_INFINITY,
      maxIndex: 0,
      recvRanges: [],
      frontierSamples: [],
      gapEpisodes: [],
    };
    segmentsBySlot.set(slot, segment);
    return segment;
  };

  for (const recvRange of recvRanges) {
    const segment = getOrCreateSegment(recvRange.slot);
    segment.start = Math.min(segment.start, recvRange.time);
    segment.end = Math.max(segment.end, recvRange.time);
    segment.maxIndex = Math.max(segment.maxIndex, recvRange.endIndex);
    segment.recvRanges.push(recvRange);
  }

  for (const frontierSample of frontierSamples) {
    const segment = getOrCreateSegment(frontierSample.slot);
    segment.start = Math.min(segment.start, frontierSample.time);
    segment.end = Math.max(segment.end, frontierSample.time);
    segment.maxIndex = Math.max(
      segment.maxIndex,
      frontierSample.highestReceived,
      frontierSample.consumed
    );
    segment.frontierSamples.push(frontierSample);
  }

  for (const lane of gapTrack.lanes) {
    for (const gapEpisode of lane) {
      const segment = getOrCreateSegment(gapEpisode.slot);
      segment.start = Math.min(segment.start, gapEpisode.start);
      segment.end = Math.max(segment.end, gapEpisode.end);
      segment.maxIndex = Math.max(segment.maxIndex, gapEpisode.endIndex);
      segment.gapEpisodes.push(gapEpisode);
    }
  }

  const segments = Array.from(segmentsBySlot.values())
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end >= range.start &&
        segment.start <= range.end
    )
    .map((segment) => {
      const visibleStart = Math.max(segment.start, range.start);
      const visibleEnd = Math.min(segment.end, range.end);

      return {
        ...segment,
        visibleStart,
        visibleEnd,
      };
    })
    .filter(
      (segment) =>
        segment.visibleStart <= segment.visibleEnd &&
        (segment.recvRanges.length > 0 ||
          segment.frontierSamples.length > 0 ||
          segment.gapEpisodes.length > 0)
    )
    .sort((a, b) => a.start - b.start || a.slot - b.slot);

  const { packed, totalLaneCount } = packIntervalsByOverlap(
    segments.map((segment) => ({
      start: segment.visibleStart,
      end: segment.visibleEnd,
    }))
  );
  const bands = Array.from(
    { length: totalLaneCount },
    () => [] as ShredHeatmapSegment[]
  );

  for (const { itemIndex, lane } of packed) {
    const segment = segments[itemIndex];
    segment.recvRanges.sort((a, b) => a.time - b.time);
    segment.frontierSamples.sort((a, b) => a.time - b.time);
    segment.gapEpisodes.sort((a, b) => a.start - b.start);
    bands[lane].push({
      slot: segment.slot,
      start: segment.start,
      end: segment.end,
      maxIndex: Math.max(segment.maxIndex, 1),
      recvRanges: segment.recvRanges,
      frontierSamples: segment.frontierSamples,
      gapEpisodes: segment.gapEpisodes,
    });
  }

  for (const band of bands) {
    band.sort((a, b) => a.start - b.start || a.slot - b.slot);
  }

  return { bands, totalBandCount: totalLaneCount };
}
