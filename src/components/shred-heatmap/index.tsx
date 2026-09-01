/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as React from 'react';

import { Tooltip } from 'firefox-profiler/components/tooltip/Tooltip';
import {
  TooltipDetail,
  TooltipDetails,
} from 'firefox-profiler/components/tooltip/TooltipDetails';
import { withSize } from 'firefox-profiler/components/shared/WithSize';
import {
  TIMELINE_MARGIN_LEFT,
  TIMELINE_MARGIN_RIGHT,
} from 'firefox-profiler/app-logic/constants';
import { changeMouseTimePosition } from 'firefox-profiler/actions/profile-view';
import {
  getPreviewSelectionIsBeingModified,
  getCommittedRange,
  getProfileTimelineUnit,
  getPreviewSelectionRange,
  getZeroAt,
} from 'firefox-profiler/selectors/profile';
import { selectedThreadSelectors } from 'firefox-profiler/selectors/per-thread';
import { getFormattedTimelineValue } from 'firefox-profiler/profile-logic/committed-ranges';
import explicitConnect from 'firefox-profiler/utils/connect';

import type {
  CssPixels,
  Milliseconds,
  StartEndRange,
  TimelineUnit,
} from 'firefox-profiler/types';
import type { SizeProps } from 'firefox-profiler/components/shared/WithSize';
import type { ConnectedProps } from 'firefox-profiler/utils/connect';
import type {
  PackedShredHeatmap,
  ShredGapEpisode,
  ShredHeatmapSegment,
  ShredRecvRange,
} from 'firefox-profiler/profile-logic/shreds';

import './index.css';

const HEATMAP_PLOT_PADDING_TOP = 10;
const HEATMAP_PLOT_PADDING_BOTTOM = 10;
const HEATMAP_MIN_PLOT_HEIGHT = 96;
const HEATMAP_MAX_PLOT_HEIGHT = 640;
const HEATMAP_PIXELS_PER_INDEX = 0.2;
const HEATMAP_LABEL_THRESHOLD = 80;
const HEATMAP_RECV_MIN_RADIUS = 2;
const HEATMAP_RECV_MAX_RADIUS = 5;
const HEATMAP_RECV_MIN_OPACITY = 0.68;
const HEATMAP_RECV_MAX_OPACITY = 0.96;
const HEATMAP_RECV_HEAT_CAP = 100;
const HEATMAP_REPAIR_MIN_OPACITY = 0.9;
const HEATMAP_REPAIR_MAX_OPACITY = 1;
const HEATMAP_RECOVERED_MIN_OPACITY = 0.7;
const HEATMAP_RECOVERED_MAX_OPACITY = 0.95;
const HEATMAP_REPAIR_STROKE_WIDTH = 1.5;
const HEATMAP_RECOVERED_STROKE_WIDTH = 1;
const HEATMAP_RECV_HOVER_OUTLINE_WIDTH = 2.5;
const HEATMAP_RECV_HOVER_RING_WIDTH = 1.25;
const HEATMAP_RECV_HOVER_RING_PADDING = 0.75;
const HEATMAP_FRONTIER_LINE_WIDTH = 1.5;
const HEATMAP_FRONTIER_HOVER_LINE_WIDTH = 3;
const HEATMAP_FRONTIER_HOVER_TOLERANCE = 4;
const HEATMAP_FRONTIER_LAG_LINE_WIDTH = 2;
const HEATMAP_FRONTIER_LAG_LABEL_PADDING_X = 4;
const HEATMAP_FRONTIER_LAG_LABEL_PADDING_Y = 2;
const HEATMAP_FRONTIER_LAG_LABEL_OFFSET_Y = 8;

type HoveredFrontierLine = Readonly<{
  kind: 'consumed' | 'highestReceived';
  value: number;
}>;

type HoveredFrontierLag = Readonly<{
  value: number;
  highestReceivedTime: Milliseconds;
  consumedTime: Milliseconds;
  delay: Milliseconds;
}>;

type HoveredHeatmapTarget = Readonly<{
  segment: ShredHeatmapSegment;
  time: Milliseconds;
  recvRanges: ReadonlyArray<ShredRecvRange>;
  gapEpisode: ShredGapEpisode | null;
  frontierLine: HoveredFrontierLine | null;
  frontierLag: HoveredFrontierLag | null;
}>;

type OwnProps = {};

type StateProps = {
  readonly timeRange: StartEndRange;
  readonly committedRange: StartEndRange;
  readonly heatmap: PackedShredHeatmap;
  readonly isModifyingSelection: boolean;
  readonly chartPaddingLeft: CssPixels;
  readonly chartPaddingRight: CssPixels;
  readonly zeroAt: Milliseconds;
  readonly profileTimelineUnit: TimelineUnit;
};

type DispatchProps = {
  readonly changeMouseTimePosition: typeof changeMouseTimePosition;
};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps> & SizeProps;

type RecvFilter = 'root' | 'l1' | 'l2' | 'l3' | 'recovered' | 'repair';
type ShredKindFilter = ShredRecvRange['shredKind'];

type State = {
  readonly hoveredTarget: HoveredHeatmapTarget | null;
  readonly mouseX: CssPixels;
  readonly mouseY: CssPixels;
  readonly selectedRecvFilters: ReadonlySet<RecvFilter>;
  readonly selectedShredKindFilters: ReadonlySet<ShredKindFilter>;
};

type HeatmapThemeColors = Readonly<{
  background: string;
  segmentFill: string;
  segmentStroke: string;
  label: string;
  recv: string;
  recvRoot: string;
  recvL1: string;
  recvL2: string;
  recvL3: string;
  repair: string;
  recovered: string;
  gap: string;
  consumed: string;
  highestReceived: string;
  labelFont: string;
}>;

type HeatmapBandLayout = Readonly<{
  top: CssPixels;
  height: CssPixels;
  plotHeight: CssPixels;
  segments: ReadonlyArray<ShredHeatmapSegment>;
}>;

type HeatmapLayout = Readonly<{
  bands: ReadonlyArray<HeatmapBandLayout>;
  totalHeight: CssPixels;
}>;

type ShredRecvSummary = Readonly<{
  normal: number;
  repair: number;
  recovered: number;
}>;

type HoveredRecvTooltipRow = Readonly<{
  label: string;
  value: string;
}>;

const TURBINE_LAYER_LEGEND_ITEMS = [
  { label: 'Root', className: 'shredHeatmapLegendSwatchRoot', layer: 'root' },
  { label: 'L1', className: 'shredHeatmapLegendSwatchL1', layer: 'l1' },
  { label: 'L2', className: 'shredHeatmapLegendSwatchL2', layer: 'l2' },
  { label: 'L3', className: 'shredHeatmapLegendSwatchL3', layer: 'l3' },
  {
    label: 'Recovered',
    className: 'shredHeatmapLegendSwatchRecovered',
    layer: 'recovered',
  },
  {
    label: 'Repaired',
    className: 'shredHeatmapLegendSwatchRepair',
    layer: 'repair',
  },
] as const;

const SHRED_KIND_LEGEND_ITEMS = [
  {
    label: 'Data',
    className: 'shredHeatmapLegendShapeData',
    kind: 'data',
  },
  {
    label: 'Coding',
    className: 'shredHeatmapLegendShapeCode',
    kind: 'code',
  },
] as const;

function _scaleTime(
  time: Milliseconds,
  range: StartEndRange,
  width: CssPixels
): CssPixels {
  const rangeLength = Math.max(range.end - range.start, 0.001);
  return ((time - range.start) / rangeLength) * width;
}

function _clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function _getPlotHeight(maxIndex: number): number {
  return _clamp(
    Math.ceil(maxIndex * HEATMAP_PIXELS_PER_INDEX),
    HEATMAP_MIN_PLOT_HEIGHT,
    HEATMAP_MAX_PLOT_HEIGHT
  );
}

function _getHeatmapLayout(heatmap: PackedShredHeatmap): HeatmapLayout {
  let top = 0;
  const bands = heatmap.bands.map((segments) => {
    const bandMaxIndex = Math.max(
      1,
      ...segments.map((segment) => segment.maxIndex)
    );
    const plotHeight = _getPlotHeight(bandMaxIndex);
    const height =
      HEATMAP_PLOT_PADDING_TOP + plotHeight + HEATMAP_PLOT_PADDING_BOTTOM;
    const bandLayout = {
      top,
      height,
      plotHeight,
      segments,
    };
    top += height;
    return bandLayout;
  });

  return { bands, totalHeight: top };
}

function _getBandLayoutForY(
  layout: HeatmapLayout,
  y: CssPixels
): HeatmapBandLayout | null {
  for (const band of layout.bands) {
    if (y >= band.top && y < band.top + band.height) {
      return band;
    }
  }
  return null;
}

function _scaleIndexToY(
  index: number,
  maxIndex: number,
  bandTop: CssPixels,
  plotHeight: CssPixels
): CssPixels {
  const normalized = maxIndex <= 1 ? 0 : (index - 1) / (maxIndex - 1);
  return bandTop + HEATMAP_PLOT_PADDING_TOP + (1 - normalized) * plotHeight;
}

function _getChartWidth(
  fallbackWidth: CssPixels,
  viewport: HTMLDivElement | null,
  canvas: HTMLCanvasElement | null
): CssPixels {
  const viewportWidth = viewport?.clientWidth ?? 0;
  if (viewportWidth > 0) {
    return viewportWidth;
  }

  const canvasWidth = canvas?.clientWidth ?? 0;
  if (canvasWidth > 0) {
    return canvasWidth;
  }

  return fallbackWidth;
}

function _getDrawableChartWidth(
  chartWidth: CssPixels,
  chartPaddingLeft: CssPixels,
  chartPaddingRight: CssPixels
): CssPixels {
  return Math.max(chartWidth - chartPaddingLeft - chartPaddingRight, 0);
}

function _scaleTimelineTime(
  time: Milliseconds,
  range: StartEndRange,
  chartWidth: CssPixels,
  chartPaddingLeft: CssPixels,
  chartPaddingRight: CssPixels
): CssPixels {
  return (
    chartPaddingLeft +
    _scaleTime(
      time,
      range,
      _getDrawableChartWidth(chartWidth, chartPaddingLeft, chartPaddingRight)
    )
  );
}

function _timeFromTimelineX(
  x: CssPixels,
  range: StartEndRange,
  chartWidth: CssPixels,
  chartPaddingLeft: CssPixels,
  chartPaddingRight: CssPixels
): Milliseconds | null {
  const drawableChartWidth = _getDrawableChartWidth(
    chartWidth,
    chartPaddingLeft,
    chartPaddingRight
  );
  if (drawableChartWidth <= 0) {
    return null;
  }
  const plotX = x - chartPaddingLeft;
  if (plotX < 0 || plotX > drawableChartWidth) {
    return null;
  }

  return range.start + (plotX / drawableChartWidth) * (range.end - range.start);
}

function _readThemeValue(
  style: CSSStyleDeclaration,
  propertyName: string,
  fallback: string
): string {
  return style.getPropertyValue(propertyName).trim() || fallback;
}

function _getThemeColors(element: HTMLElement): HeatmapThemeColors {
  const style = window.getComputedStyle(element);
  return {
    background: _readThemeValue(
      style,
      '--internal-heatmap-background-color',
      '#ffffff'
    ),
    segmentFill: _readThemeValue(
      style,
      '--internal-heatmap-segment-fill-color',
      'rgba(0, 0, 0, 0.025)'
    ),
    segmentStroke: _readThemeValue(
      style,
      '--internal-heatmap-segment-stroke-color',
      'rgba(0, 0, 0, 0.14)'
    ),
    label: _readThemeValue(style, '--internal-heatmap-label-color', '#15141a'),
    recv: _readThemeValue(style, '--internal-heatmap-recv-color', '#e67e22'),
    recvRoot: _readThemeValue(
      style,
      '--internal-heatmap-recv-root-color',
      '#f59e0b'
    ),
    recvL1: _readThemeValue(
      style,
      '--internal-heatmap-recv-l1-color',
      '#ff2da6'
    ),
    recvL2: _readThemeValue(
      style,
      '--internal-heatmap-recv-l2-color',
      '#8b5cf6'
    ),
    recvL3: _readThemeValue(
      style,
      '--internal-heatmap-recv-l3-color',
      '#16a34a'
    ),
    repair: _readThemeValue(
      style,
      '--internal-heatmap-repair-color',
      '#d70022'
    ),
    recovered: _readThemeValue(
      style,
      '--internal-heatmap-recovered-color',
      '#007aff'
    ),
    gap: _readThemeValue(style, '--internal-heatmap-gap-color', '#9059ff'),
    consumed: _readThemeValue(
      style,
      '--internal-heatmap-consumed-color',
      'rgba(0, 200, 0, 0.5)'
    ),
    highestReceived: _readThemeValue(
      style,
      '--internal-heatmap-highest-received-color',
      '#8f5b00'
    ),
    labelFont: _readThemeValue(
      style,
      '--internal-heatmap-label-font',
      '11px sans-serif'
    ),
  };
}

function _formatShredIndexRange(startIndex: number, endIndex: number): string {
  if (startIndex === endIndex) {
    return `${startIndex}`;
  }

  const count = endIndex - startIndex + 1;
  return `${startIndex}..${endIndex} (${count})`;
}

function _formatTimelineHoverTime(
  time: Milliseconds,
  zeroAt: Milliseconds,
  unit: TimelineUnit,
  committedRange: StartEndRange,
  width: CssPixels
): string {
  const pixelTimeResolution =
    width > 0 ? (committedRange.end - committedRange.start) / width : undefined;
  return getFormattedTimelineValue(time - zeroAt, unit, pixelTimeResolution);
}

function _formatTimelineDuration(
  duration: Milliseconds,
  unit: TimelineUnit,
  committedRange: StartEndRange,
  width: CssPixels
): string {
  const pixelTimeResolution =
    width > 0 ? (committedRange.end - committedRange.start) / width : undefined;
  return getFormattedTimelineValue(duration, unit, pixelTimeResolution);
}

function _getRecvRangeCount(recvRange: ShredRecvRange): number {
  return recvRange.endIndex - recvRange.startIndex + 1;
}

function _getRecvRangeMidIndex(recvRange: ShredRecvRange): number {
  return recvRange.startIndex + (_getRecvRangeCount(recvRange) - 1) / 2;
}

function _getRecvHeatWeight(recvRange: ShredRecvRange): number {
  const clampedCount = Math.max(
    1,
    Math.min(_getRecvRangeCount(recvRange), HEATMAP_RECV_HEAT_CAP)
  );
  return Math.log(clampedCount) / Math.log(HEATMAP_RECV_HEAT_CAP);
}

function _getRecvMarkerRadius(recvRange: ShredRecvRange): number {
  return (
    HEATMAP_RECV_MIN_RADIUS +
    _getRecvHeatWeight(recvRange) *
      (HEATMAP_RECV_MAX_RADIUS - HEATMAP_RECV_MIN_RADIUS)
  );
}

function _getRecvMarkerOpacity(recvRange: ShredRecvRange): number {
  let minOpacity = HEATMAP_RECV_MIN_OPACITY;
  let maxOpacity = HEATMAP_RECV_MAX_OPACITY;
  if (recvRange.source === 'repair') {
    minOpacity = HEATMAP_REPAIR_MIN_OPACITY;
    maxOpacity = HEATMAP_REPAIR_MAX_OPACITY;
  } else if (recvRange.source === 'recovered') {
    minOpacity = HEATMAP_RECOVERED_MIN_OPACITY;
    maxOpacity = HEATMAP_RECOVERED_MAX_OPACITY;
  }
  return minOpacity + _getRecvHeatWeight(recvRange) * (maxOpacity - minOpacity);
}

function _getRecvMarkerStrokeWidth(recvRange: ShredRecvRange): number {
  if (recvRange.source === 'repair') {
    return HEATMAP_REPAIR_STROKE_WIDTH;
  }
  if (recvRange.source === 'recovered') {
    return HEATMAP_RECOVERED_STROKE_WIDTH;
  }
  return 0;
}

function _getShredKindLabel(shredKind: ShredRecvRange['shredKind']): string {
  return shredKind === 'code' ? 'coding' : 'data';
}

function _traceRecvMarkerPath(
  ctx: CanvasRenderingContext2D,
  recvRange: ShredRecvRange,
  recvX: CssPixels,
  recvY: CssPixels,
  recvRadius: number
) {
  ctx.beginPath();
  if (recvRange.shredKind === 'code') {
    ctx.moveTo(recvX, recvY - recvRadius);
    ctx.lineTo(recvX + recvRadius, recvY);
    ctx.lineTo(recvX, recvY + recvRadius);
    ctx.lineTo(recvX - recvRadius, recvY);
    ctx.closePath();
    return;
  }
  ctx.arc(recvX, recvY, recvRadius, 0, Math.PI * 2);
}

function _getRecvMarkerHitDistance(
  recvRange: ShredRecvRange,
  recvX: CssPixels,
  recvY: CssPixels,
  targetX: CssPixels,
  targetY: CssPixels,
  recvRadius: number
): number | null {
  const dx = Math.abs(recvX - targetX);
  const dy = Math.abs(recvY - targetY);
  const boundary = recvRadius + HEATMAP_FRONTIER_HOVER_TOLERANCE;

  if (recvRange.shredKind === 'code') {
    const distance = dx + dy;
    return distance <= boundary ? distance : null;
  }

  const distance = Math.hypot(dx, dy);
  return distance <= boundary ? distance : null;
}

function _getRecvDrawPriority(recvRange: ShredRecvRange): number {
  if (recvRange.source === 'repair') {
    return 2;
  }
  if (recvRange.source === 'recovered') {
    return 1;
  }
  return 0;
}

function _isTurbineRecvSource(source: ShredRecvRange['source']): boolean {
  return source === 'turbine' || source === 'normal';
}

function _getTurbineLayerBucket(
  recvRange: ShredRecvRange
): 'root' | 'l1' | 'l2' | 'l3' | 'unknown' {
  if (
    !_isTurbineRecvSource(recvRange.source) ||
    recvRange.turbineLayer === null
  ) {
    return 'unknown';
  }
  return recvRange.turbineLayer;
}

function _getTurbineLayerLabel(
  layer: 'root' | 'l1' | 'l2' | 'l3' | 'unknown'
): string {
  switch (layer) {
    case 'root':
      return 'Root';
    case 'l1':
      return 'L1';
    case 'l2':
      return 'L2';
    case 'l3':
      return 'L3';
    default:
      return 'Received';
  }
}

function _getRecvMarkerColor(
  recvRange: ShredRecvRange,
  colors: HeatmapThemeColors
): string {
  if (recvRange.source === 'repair') {
    return colors.repair;
  }
  if (recvRange.source === 'recovered') {
    return colors.recovered;
  }
  switch (_getTurbineLayerBucket(recvRange)) {
    case 'root':
      return colors.recvRoot;
    case 'l1':
      return colors.recvL1;
    case 'l2':
      return colors.recvL2;
    case 'l3':
      return colors.recvL3;
    default:
      return colors.recv;
  }
}

function _getRecvFilterBucket(
  recvRange: ShredRecvRange
): RecvFilter | 'unknown' {
  if (recvRange.source === 'repair') {
    return 'repair';
  }
  if (recvRange.source === 'recovered') {
    return 'recovered';
  }
  return _getTurbineLayerBucket(recvRange);
}

function _getVisibleRecvRanges(
  recvRanges: ReadonlyArray<ShredRecvRange>,
  selectedRecvFilters: ReadonlySet<RecvFilter>,
  selectedShredKindFilters: ReadonlySet<ShredKindFilter>
): ReadonlyArray<ShredRecvRange> {
  return recvRanges.filter((recvRange) => {
    const filterBucket = _getRecvFilterBucket(recvRange);
    const matchesRecvFilter =
      selectedRecvFilters.size === 0 ||
      (filterBucket !== 'unknown' && selectedRecvFilters.has(filterBucket));
    const matchesShredKindFilter =
      selectedShredKindFilters.size === 0 ||
      selectedShredKindFilters.has(recvRange.shredKind);
    return matchesRecvFilter && matchesShredKindFilter;
  });
}

function _toggleFilter<T>(
  selectedFilters: ReadonlySet<T>,
  selectedFilter: T
): ReadonlySet<T> {
  if (selectedFilters.has(selectedFilter)) {
    return new Set(
      [...selectedFilters].filter((filter) => filter !== selectedFilter)
    );
  }

  return new Set([...selectedFilters, selectedFilter]);
}

function _isRecvFilter(value: string): value is RecvFilter {
  switch (value) {
    case 'root':
    case 'l1':
    case 'l2':
    case 'l3':
    case 'recovered':
    case 'repair':
      return true;
    default:
      return false;
  }
}

function _isShredKindFilter(value: string): value is ShredKindFilter {
  return value === 'data' || value === 'code';
}

function _sortRecvRangesAscending(
  recvRanges: ReadonlyArray<ShredRecvRange>
): ReadonlyArray<ShredRecvRange> {
  return [...recvRanges].sort(
    (a, b) =>
      a.startIndex - b.startIndex ||
      a.endIndex - b.endIndex ||
      a.time - b.time ||
      a.markerIndex - b.markerIndex
  );
}

function _getShredRecvSummary(
  recvRanges: ReadonlyArray<ShredRecvRange>
): ShredRecvSummary {
  const summary = {
    normal: 0,
    repair: 0,
    recovered: 0,
  };

  for (const recvRange of recvRanges) {
    const count = _getRecvRangeCount(recvRange);
    if (recvRange.source === 'repair') {
      summary.repair += count;
    } else if (recvRange.source === 'recovered') {
      summary.recovered += count;
    } else {
      summary.normal += count;
    }
  }

  return summary;
}

function _getHoveredRecvTooltipRows(
  recvRanges: ReadonlyArray<ShredRecvRange>
): ReadonlyArray<HoveredRecvTooltipRow> {
  const hoveredRecvRangesBySource = {
    root: [] as ShredRecvRange[],
    l1: [] as ShredRecvRange[],
    l2: [] as ShredRecvRange[],
    l3: [] as ShredRecvRange[],
    received: [] as ShredRecvRange[],
    recovered: [] as ShredRecvRange[],
    repair: [] as ShredRecvRange[],
  };

  for (const recvRange of recvRanges) {
    if (recvRange.source === 'repair') {
      hoveredRecvRangesBySource.repair.push(recvRange);
    } else if (recvRange.source === 'recovered') {
      hoveredRecvRangesBySource.recovered.push(recvRange);
    } else {
      switch (_getTurbineLayerBucket(recvRange)) {
        case 'root':
          hoveredRecvRangesBySource.root.push(recvRange);
          break;
        case 'l1':
          hoveredRecvRangesBySource.l1.push(recvRange);
          break;
        case 'l2':
          hoveredRecvRangesBySource.l2.push(recvRange);
          break;
        case 'l3':
          hoveredRecvRangesBySource.l3.push(recvRange);
          break;
        default:
          hoveredRecvRangesBySource.received.push(recvRange);
          break;
      }
    }
  }

  const rows: HoveredRecvTooltipRow[] = [];
  const orderedSources: Array<{
    label: string;
    recvRanges: ReadonlyArray<ShredRecvRange>;
  }> = [
    {
      label: _getTurbineLayerLabel('root'),
      recvRanges: hoveredRecvRangesBySource.root,
    },
    {
      label: _getTurbineLayerLabel('l1'),
      recvRanges: hoveredRecvRangesBySource.l1,
    },
    {
      label: _getTurbineLayerLabel('l2'),
      recvRanges: hoveredRecvRangesBySource.l2,
    },
    {
      label: _getTurbineLayerLabel('l3'),
      recvRanges: hoveredRecvRangesBySource.l3,
    },
    {
      label: _getTurbineLayerLabel('unknown'),
      recvRanges: hoveredRecvRangesBySource.received,
    },
    {
      label: 'Recovered',
      recvRanges: hoveredRecvRangesBySource.recovered,
    },
    {
      label: 'Repaired',
      recvRanges: hoveredRecvRangesBySource.repair,
    },
  ];

  for (const { label, recvRanges: sourceRecvRanges } of orderedSources) {
    for (const shredKind of ['data', 'code'] as const) {
      const kindRecvRanges = _sortRecvRangesAscending(
        sourceRecvRanges.filter(
          (recvRange) => recvRange.shredKind === shredKind
        )
      );
      if (kindRecvRanges.length === 0) {
        continue;
      }
      const totalCount = kindRecvRanges.reduce(
        (count, recvRange) => count + _getRecvRangeCount(recvRange),
        0
      );
      rows.push({
        label: `${label} ${_getShredKindLabel(shredKind)}`,
        value: `${kindRecvRanges
          .map((recvRange) =>
            recvRange.startIndex === recvRange.endIndex
              ? `${recvRange.startIndex}`
              : `${recvRange.startIndex}..${recvRange.endIndex}`
          )
          .join(', ')} (${totalCount})`,
      });
    }
  }

  return rows;
}

function _getRecvTimeBucket(time: Milliseconds): number {
  return Math.floor(time);
}

function _getDistanceToHorizontalLine(
  x: CssPixels,
  y: CssPixels,
  left: CssPixels,
  right: CssPixels,
  lineY: CssPixels
): number | null {
  if (x < left || x > right) {
    return null;
  }
  return Math.abs(y - lineY);
}

function _getDistanceToVerticalLine(
  x: CssPixels,
  y: CssPixels,
  lineX: CssPixels,
  top: CssPixels,
  bottom: CssPixels
): number | null {
  if (y < top || y > bottom) {
    return null;
  }
  return Math.abs(x - lineX);
}

function _getHoveredFrontierLine(
  segment: ShredHeatmapSegment,
  bandTop: CssPixels,
  plotHeight: CssPixels,
  x: CssPixels,
  y: CssPixels,
  chartWidth: CssPixels,
  range: StartEndRange,
  chartPaddingLeft: CssPixels,
  chartPaddingRight: CssPixels
): HoveredFrontierLine | null {
  if (segment.frontierSamples.length === 0) {
    return null;
  }

  let bestMatch: (HoveredFrontierLine & { distance: number }) | null = null;

  const frontierLines = [
    {
      kind: 'consumed' as const,
      valueGetter: (sample: ShredHeatmapSegment['frontierSamples'][number]) =>
        sample.consumed,
    },
    {
      kind: 'highestReceived' as const,
      valueGetter: (sample: ShredHeatmapSegment['frontierSamples'][number]) =>
        sample.highestReceived,
    },
  ];

  for (const { kind, valueGetter } of frontierLines) {
    let previousValue = valueGetter(segment.frontierSamples[0]);
    let previousY = _scaleIndexToY(
      previousValue,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    let previousX = _scaleTimelineTime(
      segment.frontierSamples[0].time,
      range,
      chartWidth,
      chartPaddingLeft,
      chartPaddingRight
    );

    for (let i = 1; i < segment.frontierSamples.length; i++) {
      const sample = segment.frontierSamples[i];
      const nextValue = valueGetter(sample);
      const nextX = _scaleTimelineTime(
        sample.time,
        range,
        chartWidth,
        chartPaddingLeft,
        chartPaddingRight
      );
      const nextY = _scaleIndexToY(
        nextValue,
        segment.maxIndex,
        bandTop,
        plotHeight
      );
      const horizontalDistance = _getDistanceToHorizontalLine(
        x,
        y,
        Math.min(previousX, nextX),
        Math.max(previousX, nextX),
        previousY
      );
      if (
        horizontalDistance !== null &&
        horizontalDistance <= HEATMAP_FRONTIER_HOVER_TOLERANCE &&
        (bestMatch === null || horizontalDistance < bestMatch.distance)
      ) {
        bestMatch = {
          kind,
          value: previousValue,
          distance: horizontalDistance,
        };
      }

      const verticalDistance = _getDistanceToVerticalLine(
        x,
        y,
        nextX,
        Math.min(previousY, nextY),
        Math.max(previousY, nextY)
      );
      if (
        verticalDistance !== null &&
        verticalDistance <= HEATMAP_FRONTIER_HOVER_TOLERANCE
      ) {
        const value =
          Math.abs(y - previousY) <= Math.abs(y - nextY)
            ? previousValue
            : nextValue;
        if (bestMatch === null || verticalDistance < bestMatch.distance) {
          bestMatch = { kind, value, distance: verticalDistance };
        }
      }

      previousValue = nextValue;
      previousX = nextX;
      previousY = nextY;
    }

    const segmentEndX = Math.max(
      previousX,
      _scaleTimelineTime(
        segment.end,
        range,
        chartWidth,
        chartPaddingLeft,
        chartPaddingRight
      )
    );
    const trailingDistance = _getDistanceToHorizontalLine(
      x,
      y,
      Math.min(previousX, segmentEndX),
      Math.max(previousX, segmentEndX),
      previousY
    );
    if (
      trailingDistance !== null &&
      trailingDistance <= HEATMAP_FRONTIER_HOVER_TOLERANCE &&
      (bestMatch === null || trailingDistance < bestMatch.distance)
    ) {
      bestMatch = {
        kind,
        value: previousValue,
        distance: trailingDistance,
      };
    }
  }

  if (bestMatch === null) {
    return null;
  }

  const { distance: _distance, ...frontierLine } = bestMatch;
  return frontierLine;
}

function _getFrontierReachTime(
  segment: ShredHeatmapSegment,
  kind: HoveredFrontierLine['kind'],
  value: number
): Milliseconds | null {
  for (const sample of segment.frontierSamples) {
    if (sample[kind] >= value) {
      return sample.time;
    }
  }

  return null;
}

function _getHoveredFrontierLag(
  segment: ShredHeatmapSegment,
  frontierLine: HoveredFrontierLine | null
): HoveredFrontierLag | null {
  if (frontierLine === null) {
    return null;
  }

  const highestReceivedTime = _getFrontierReachTime(
    segment,
    'highestReceived',
    frontierLine.value
  );
  const consumedTime = _getFrontierReachTime(
    segment,
    'consumed',
    frontierLine.value
  );

  if (
    highestReceivedTime === null ||
    consumedTime === null ||
    consumedTime <= highestReceivedTime
  ) {
    return null;
  }

  return {
    value: frontierLine.value,
    highestReceivedTime,
    consumedTime,
    delay: consumedTime - highestReceivedTime,
  };
}

class ShredHeatmapImpl extends React.PureComponent<Props, State> {
  override state: State = {
    hoveredTarget: null,
    mouseX: 0,
    mouseY: 0,
    selectedRecvFilters: new Set(),
    selectedShredKindFilters: new Set(),
  };

  _canvas = React.createRef<HTMLCanvasElement>();
  _viewport = React.createRef<HTMLDivElement>();
  _requestedAnimationFrame = false;

  override componentDidMount() {
    this._scheduleDraw();
  }

  override componentDidUpdate() {
    this._scheduleDraw();
  }

  _scheduleDraw() {
    if (this._requestedAnimationFrame) {
      return;
    }
    this._requestedAnimationFrame = true;
    window.requestAnimationFrame(() => {
      this._requestedAnimationFrame = false;
      const canvas = this._canvas.current;
      if (canvas) {
        this.drawCanvas(canvas);
      }
    });
  }

  _findHoveredTarget(x: CssPixels, y: CssPixels): HoveredHeatmapTarget | null {
    const { chartPaddingLeft, chartPaddingRight, heatmap, timeRange, width } =
      this.props;
    const chartWidth = _getChartWidth(
      width,
      this._viewport.current,
      this._canvas.current
    );
    if (chartWidth <= 0) {
      return null;
    }

    const layout = _getHeatmapLayout(heatmap);
    const band = _getBandLayoutForY(layout, y);
    if (!band) {
      return null;
    }

    const bandTop = band.top;
    const time = _timeFromTimelineX(
      x,
      timeRange,
      chartWidth,
      chartPaddingLeft,
      chartPaddingRight
    );
    if (time === null) {
      return null;
    }

    const plotHeight = band.plotHeight;
    for (const segment of band.segments) {
      const left = _scaleTimelineTime(
        segment.start,
        timeRange,
        chartWidth,
        chartPaddingLeft,
        chartPaddingRight
      );
      const right = Math.max(
        left + 1,
        _scaleTimelineTime(
          segment.end,
          timeRange,
          chartWidth,
          chartPaddingLeft,
          chartPaddingRight
        )
      );
      if (x < left || x > right) {
        continue;
      }

      const visibleRecvRanges = _getVisibleRecvRanges(
        segment.recvRanges,
        this.state.selectedRecvFilters,
        this.state.selectedShredKindFilters
      );
      let nearestRecvRange: (ShredRecvRange & { distance: number }) | null =
        null;
      for (const candidate of visibleRecvRanges) {
        const recvX = _scaleTimelineTime(
          candidate.time,
          timeRange,
          chartWidth,
          chartPaddingLeft,
          chartPaddingRight
        );
        const recvY = _scaleIndexToY(
          _getRecvRangeMidIndex(candidate),
          segment.maxIndex,
          bandTop,
          plotHeight
        );
        const recvRadius = _getRecvMarkerRadius(candidate);
        const distance = _getRecvMarkerHitDistance(
          candidate,
          recvX,
          recvY,
          x,
          y,
          recvRadius
        );
        if (
          distance !== null &&
          (nearestRecvRange === null || distance < nearestRecvRange.distance)
        ) {
          nearestRecvRange = {
            ...candidate,
            distance,
          };
        }
      }
      const recvRanges =
        nearestRecvRange === null
          ? []
          : visibleRecvRanges.filter(
              (candidate) =>
                _getRecvTimeBucket(candidate.time) ===
                _getRecvTimeBucket(nearestRecvRange.time)
            );

      let gapEpisode: ShredGapEpisode | null = null;
      for (const candidate of segment.gapEpisodes) {
        const gapLeft = _scaleTimelineTime(
          candidate.start,
          timeRange,
          chartWidth,
          chartPaddingLeft,
          chartPaddingRight
        );
        const gapRight = Math.max(
          gapLeft + 1,
          _scaleTimelineTime(
            candidate.end,
            timeRange,
            chartWidth,
            chartPaddingLeft,
            chartPaddingRight
          )
        );
        const gapTop = _scaleIndexToY(
          candidate.endIndex,
          segment.maxIndex,
          bandTop,
          plotHeight
        );
        const gapBottom = _scaleIndexToY(
          candidate.startIndex,
          segment.maxIndex,
          bandTop,
          plotHeight
        );
        if (
          x >= gapLeft &&
          x <= gapRight &&
          y >= gapTop - 2 &&
          y <= gapBottom + 2
        ) {
          gapEpisode = candidate;
          break;
        }
      }

      const frontierLine = _getHoveredFrontierLine(
        segment,
        bandTop,
        plotHeight,
        x,
        y,
        chartWidth,
        timeRange,
        chartPaddingLeft,
        chartPaddingRight
      );

      return {
        segment,
        time,
        recvRanges,
        gapEpisode,
        frontierLine,
        frontierLag: _getHoveredFrontierLag(segment, frontierLine),
      };
    }

    return null;
  }
  _onMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const chartWidth = _getChartWidth(
      this.props.width,
      this._viewport.current,
      this._canvas.current
    );
    const time = _timeFromTimelineX(
      x,
      this.props.timeRange,
      chartWidth,
      this.props.chartPaddingLeft,
      this.props.chartPaddingRight
    );

    this.props.changeMouseTimePosition(time);

    const viewport = this._viewport.current;
    if (!viewport) {
      return;
    }
    const y = event.clientY - rect.top + viewport.scrollTop;
    this.setState({
      hoveredTarget: this._findHoveredTarget(x, y),
      mouseX: event.pageX,
      mouseY: event.pageY,
    });
  };

  _onMouseLeave = () => {
    this.props.changeMouseTimePosition(null);
    this.setState({ hoveredTarget: null });
  };

  _onLegendFilterToggle = (selectedRecvFilter: RecvFilter) => {
    this.props.changeMouseTimePosition(null);
    this.setState((previousState) => ({
      hoveredTarget: null,
      selectedRecvFilters: _toggleFilter(
        previousState.selectedRecvFilters,
        selectedRecvFilter
      ),
    }));
  };

  _onShredKindFilterToggle = (selectedShredKindFilter: ShredKindFilter) => {
    this.props.changeMouseTimePosition(null);
    this.setState((previousState) => ({
      hoveredTarget: null,
      selectedShredKindFilters: _toggleFilter(
        previousState.selectedShredKindFilters,
        selectedShredKindFilter
      ),
    }));
  };

  _onLegendFilterButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const layer = event.currentTarget.dataset.layer;
    if (layer && _isRecvFilter(layer)) {
      this._onLegendFilterToggle(layer);
    }

    const kind = event.currentTarget.dataset.kind;
    if (kind && _isShredKindFilter(kind)) {
      this._onShredKindFilterToggle(kind);
    }
  };

  _drawStepLine(
    ctx: CanvasRenderingContext2D,
    segment: ShredHeatmapSegment,
    bandTop: CssPixels,
    plotHeight: CssPixels,
    width: CssPixels,
    range: StartEndRange,
    chartPaddingLeft: CssPixels,
    chartPaddingRight: CssPixels,
    valueGetter: (
      segment: ShredHeatmapSegment['frontierSamples'][number]
    ) => number
  ) {
    if (segment.frontierSamples.length === 0) {
      return;
    }

    ctx.beginPath();
    let previousY = _scaleIndexToY(
      valueGetter(segment.frontierSamples[0]),
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    let previousX = _scaleTimelineTime(
      segment.frontierSamples[0].time,
      range,
      width,
      chartPaddingLeft,
      chartPaddingRight
    );
    ctx.moveTo(previousX, previousY);

    for (let i = 1; i < segment.frontierSamples.length; i++) {
      const sample = segment.frontierSamples[i];
      const nextX = _scaleTimelineTime(
        sample.time,
        range,
        width,
        chartPaddingLeft,
        chartPaddingRight
      );
      const nextY = _scaleIndexToY(
        valueGetter(sample),
        segment.maxIndex,
        bandTop,
        plotHeight
      );
      ctx.lineTo(nextX, previousY);
      ctx.lineTo(nextX, nextY);
      previousX = nextX;
      previousY = nextY;
    }

    ctx.lineTo(
      Math.max(
        previousX,
        _scaleTimelineTime(
          segment.end,
          range,
          width,
          chartPaddingLeft,
          chartPaddingRight
        )
      ),
      previousY
    );
    ctx.stroke();
  }

  _drawRecvMarker(
    ctx: CanvasRenderingContext2D,
    recvRange: ShredRecvRange,
    segment: ShredHeatmapSegment,
    bandTop: CssPixels,
    plotHeight: CssPixels,
    chartWidth: CssPixels,
    timeRange: StartEndRange,
    chartPaddingLeft: CssPixels,
    chartPaddingRight: CssPixels,
    colors: HeatmapThemeColors,
    hoveredTarget: HoveredHeatmapTarget | null
  ) {
    const recvX = _scaleTimelineTime(
      recvRange.time,
      timeRange,
      chartWidth,
      chartPaddingLeft,
      chartPaddingRight
    );
    const recvY = _scaleIndexToY(
      _getRecvRangeMidIndex(recvRange),
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const recvRadius = _getRecvMarkerRadius(recvRange);
    const recvColor = _getRecvMarkerColor(recvRange, colors);
    ctx.globalAlpha = _getRecvMarkerOpacity(recvRange);
    ctx.fillStyle = recvColor;
    _traceRecvMarkerPath(ctx, recvRange, recvX, recvY, recvRadius);
    ctx.fill();
    ctx.globalAlpha = 1;
    const strokeWidth = _getRecvMarkerStrokeWidth(recvRange);
    if (strokeWidth > 0) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = recvColor;
      ctx.stroke();
    }
    if (
      hoveredTarget?.recvRanges.some(
        (candidate) => candidate.markerIndex === recvRange.markerIndex
      )
    ) {
      const hoveredRadius = recvRadius + HEATMAP_RECV_HOVER_RING_PADDING;
      _traceRecvMarkerPath(ctx, recvRange, recvX, recvY, hoveredRadius);
      ctx.lineWidth = HEATMAP_RECV_HOVER_OUTLINE_WIDTH;
      ctx.strokeStyle = colors.background;
      ctx.stroke();
      _traceRecvMarkerPath(ctx, recvRange, recvX, recvY, hoveredRadius);
      ctx.lineWidth = HEATMAP_RECV_HOVER_RING_WIDTH;
      ctx.strokeStyle = recvColor;
      ctx.stroke();
    }
  }

  _drawHoveredFrontierLag(
    ctx: CanvasRenderingContext2D,
    frontierLag: HoveredFrontierLag,
    segment: ShredHeatmapSegment,
    bandTop: CssPixels,
    plotHeight: CssPixels,
    chartWidth: CssPixels,
    timeRange: StartEndRange,
    chartPaddingLeft: CssPixels,
    chartPaddingRight: CssPixels,
    colors: HeatmapThemeColors
  ) {
    const y = _scaleIndexToY(
      frontierLag.value,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const leftX = _scaleTimelineTime(
      frontierLag.highestReceivedTime,
      timeRange,
      chartWidth,
      chartPaddingLeft,
      chartPaddingRight
    );
    const rightX = _scaleTimelineTime(
      frontierLag.consumedTime,
      timeRange,
      chartWidth,
      chartPaddingLeft,
      chartPaddingRight
    );
    const label = _formatTimelineDuration(
      frontierLag.delay,
      this.props.profileTimelineUnit,
      this.props.committedRange,
      chartWidth
    );

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftX, y);
    ctx.lineTo(rightX, y);
    ctx.lineWidth = HEATMAP_FRONTIER_LAG_LINE_WIDTH;
    ctx.strokeStyle = colors.label;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    const textMetrics = ctx.measureText(label);
    const labelWidth =
      textMetrics.width + HEATMAP_FRONTIER_LAG_LABEL_PADDING_X * 2;
    const labelHeight = 11 + HEATMAP_FRONTIER_LAG_LABEL_PADDING_Y * 2;
    const centeredLabelX = (leftX + rightX) / 2 - labelWidth / 2;
    const labelX = _clamp(
      centeredLabelX,
      0,
      Math.max(chartWidth - labelWidth, 0)
    );
    const centeredLabelY =
      y - HEATMAP_FRONTIER_LAG_LABEL_OFFSET_Y - labelHeight;
    const labelY = Math.max(centeredLabelY, bandTop + HEATMAP_PLOT_PADDING_TOP);

    ctx.fillStyle = colors.background;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.segmentStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth - 1, labelHeight - 1);
    ctx.fillStyle = colors.label;
    ctx.font = colors.labelFont;
    ctx.fillText(
      label,
      labelX + HEATMAP_FRONTIER_LAG_LABEL_PADDING_X,
      labelY + labelHeight - HEATMAP_FRONTIER_LAG_LABEL_PADDING_Y - 1
    );
    ctx.restore();
  }

  drawCanvas(canvas: HTMLCanvasElement) {
    const { chartPaddingLeft, chartPaddingRight, heatmap, timeRange, width } =
      this.props;
    const chartWidth = _getChartWidth(width, this._viewport.current, canvas);
    if (chartWidth <= 0) {
      return;
    }
    const devicePixelRatio = window.devicePixelRatio || 1;
    const layout = _getHeatmapLayout(heatmap);
    const canvasHeight = Math.max(layout.totalHeight, 1);
    canvas.width = Math.round(chartWidth * devicePixelRatio);
    canvas.height = Math.round(canvasHeight * devicePixelRatio);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const colors = _getThemeColors(canvas);
    const { hoveredTarget, selectedRecvFilters, selectedShredKindFilters } =
      this.state;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(devicePixelRatio, devicePixelRatio);

    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, chartWidth, canvasHeight);

    for (const band of layout.bands) {
      const bandTop = band.top;
      const plotHeight = band.plotHeight;

      ctx.fillStyle = colors.background;
      ctx.fillRect(0, bandTop, chartWidth, band.height);

      for (const segment of band.segments) {
        const left = _scaleTimelineTime(
          segment.start,
          timeRange,
          chartWidth,
          chartPaddingLeft,
          chartPaddingRight
        );
        const right = Math.max(
          left + 2,
          _scaleTimelineTime(
            segment.end,
            timeRange,
            chartWidth,
            chartPaddingLeft,
            chartPaddingRight
          )
        );
        const segmentWidth = right - left;

        ctx.fillStyle = colors.segmentFill;
        ctx.fillRect(left, bandTop + 4, segmentWidth, band.height - 8);
        ctx.strokeStyle = colors.segmentStroke;
        ctx.strokeRect(
          left + 0.5,
          bandTop + 4.5,
          Math.max(segmentWidth - 1, 1),
          band.height - 9
        );

        if (segmentWidth >= HEATMAP_LABEL_THRESHOLD) {
          ctx.fillStyle = colors.label;
          ctx.font = colors.labelFont;
          ctx.fillText(`slot ${segment.slot}`, left + 6, bandTop + 14);
        }

        const recvRangesInDrawOrder = [
          ..._getVisibleRecvRanges(
            segment.recvRanges,
            selectedRecvFilters,
            selectedShredKindFilters
          ),
        ].sort(
          (a, b) =>
            _getRecvDrawPriority(a) - _getRecvDrawPriority(b) ||
            a.time - b.time ||
            a.startIndex - b.startIndex ||
            a.endIndex - b.endIndex
        );
        const repairRecvRanges = recvRangesInDrawOrder.filter(
          (recvRange) => recvRange.source === 'repair'
        );
        const backgroundRecvRanges = recvRangesInDrawOrder.filter(
          (recvRange) => recvRange.source !== 'repair'
        );
        for (const recvRange of backgroundRecvRanges) {
          this._drawRecvMarker(
            ctx,
            recvRange,
            segment,
            bandTop,
            plotHeight,
            chartWidth,
            timeRange,
            chartPaddingLeft,
            chartPaddingRight,
            colors,
            hoveredTarget
          );
        }

        ctx.setLineDash([4, 2]);
        for (const gapEpisode of segment.gapEpisodes) {
          const gapLeft = _scaleTimelineTime(
            gapEpisode.start,
            timeRange,
            chartWidth,
            chartPaddingLeft,
            chartPaddingRight
          );
          const gapRight = Math.max(
            gapLeft + 2,
            _scaleTimelineTime(
              gapEpisode.end,
              timeRange,
              chartWidth,
              chartPaddingLeft,
              chartPaddingRight
            )
          );
          const gapTop = _scaleIndexToY(
            gapEpisode.endIndex,
            segment.maxIndex,
            bandTop,
            plotHeight
          );
          const gapBottom = _scaleIndexToY(
            gapEpisode.startIndex,
            segment.maxIndex,
            bandTop,
            plotHeight
          );
          ctx.strokeStyle = colors.gap;
          ctx.strokeRect(
            gapLeft + 0.5,
            gapTop + 0.5,
            Math.max(gapRight - gapLeft - 1, 1),
            Math.max(gapBottom - gapTop, 1)
          );
        }
        ctx.setLineDash([]);

        ctx.lineWidth = HEATMAP_FRONTIER_LINE_WIDTH;
        ctx.strokeStyle = colors.consumed;
        this._drawStepLine(
          ctx,
          segment,
          bandTop,
          plotHeight,
          chartWidth,
          timeRange,
          chartPaddingLeft,
          chartPaddingRight,
          (sample) => sample.consumed
        );

        if (
          hoveredTarget?.segment === segment &&
          hoveredTarget.frontierLine?.kind === 'consumed'
        ) {
          ctx.lineWidth = HEATMAP_FRONTIER_HOVER_LINE_WIDTH;
          ctx.strokeStyle = colors.consumed;
          this._drawStepLine(
            ctx,
            segment,
            bandTop,
            plotHeight,
            chartWidth,
            timeRange,
            chartPaddingLeft,
            chartPaddingRight,
            (sample) => sample.consumed
          );
        }

        ctx.lineWidth = HEATMAP_FRONTIER_LINE_WIDTH;
        ctx.strokeStyle = colors.highestReceived;
        this._drawStepLine(
          ctx,
          segment,
          bandTop,
          plotHeight,
          chartWidth,
          timeRange,
          chartPaddingLeft,
          chartPaddingRight,
          (sample) => sample.highestReceived
        );

        if (
          hoveredTarget?.segment === segment &&
          hoveredTarget.frontierLine?.kind === 'highestReceived'
        ) {
          ctx.lineWidth = HEATMAP_FRONTIER_HOVER_LINE_WIDTH;
          ctx.strokeStyle = colors.highestReceived;
          this._drawStepLine(
            ctx,
            segment,
            bandTop,
            plotHeight,
            chartWidth,
            timeRange,
            chartPaddingLeft,
            chartPaddingRight,
            (sample) => sample.highestReceived
          );
        }

        if (
          hoveredTarget?.segment === segment &&
          hoveredTarget.frontierLag !== null
        ) {
          this._drawHoveredFrontierLag(
            ctx,
            hoveredTarget.frontierLag,
            segment,
            bandTop,
            plotHeight,
            chartWidth,
            timeRange,
            chartPaddingLeft,
            chartPaddingRight,
            colors
          );
        }

        for (const recvRange of repairRecvRanges) {
          this._drawRecvMarker(
            ctx,
            recvRange,
            segment,
            bandTop,
            plotHeight,
            chartWidth,
            timeRange,
            chartPaddingLeft,
            chartPaddingRight,
            colors,
            hoveredTarget
          );
        }

        ctx.lineWidth = 1;
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  override render() {
    const {
      committedRange,
      heatmap,
      height,
      isModifyingSelection,
      profileTimelineUnit,
      width,
      zeroAt,
    } = this.props;
    const {
      hoveredTarget,
      mouseX,
      mouseY,
      selectedRecvFilters,
      selectedShredKindFilters,
    } = this.state;
    const viewportHeight = Math.max(height, 0);
    const visibleRecvRangesForHoveredSegment =
      hoveredTarget !== null
        ? _getVisibleRecvRanges(
            hoveredTarget.segment.recvRanges,
            selectedRecvFilters,
            selectedShredKindFilters
          )
        : [];
    const isSummaryHover =
      hoveredTarget !== null &&
      hoveredTarget.recvRanges.length === 0 &&
      hoveredTarget.gapEpisode === null &&
      hoveredTarget.frontierLine === null;
    const recvSummary =
      hoveredTarget !== null
        ? _getShredRecvSummary(visibleRecvRangesForHoveredSegment)
        : null;
    const hoveredRecvTooltipRows =
      hoveredTarget !== null
        ? _getHoveredRecvTooltipRows(hoveredTarget.recvRanges)
        : [];

    if (heatmap.totalBandCount === 0) {
      return (
        <div
          className="shredHeatmap"
          id="shred-heatmap-tab"
          role="tabpanel"
          aria-labelledby="shred-heatmap-tab-button"
        >
          <div className="shredHeatmapEmpty">
            No shred data is visible in this range.
          </div>
        </div>
      );
    }

    return (
      <div
        className="shredHeatmap"
        id="shred-heatmap-tab"
        role="tabpanel"
        aria-labelledby="shred-heatmap-tab-button"
      >
        <div className="shredHeatmapLegend" aria-label="Shred heatmap legend">
          <span className="shredHeatmapLegendTitle">Turbine layers</span>
          {TURBINE_LAYER_LEGEND_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="shredHeatmapLegendItem shredHeatmapLegendButton"
              data-layer={item.layer}
              data-active={selectedRecvFilters.has(item.layer)}
              aria-pressed={selectedRecvFilters.has(item.layer)}
              onClick={this._onLegendFilterButtonClick}
            >
              <span
                className={`shredHeatmapLegendSwatch ${item.className}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </button>
          ))}
          <span className="shredHeatmapLegendTitle">Shreds</span>
          {SHRED_KIND_LEGEND_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="shredHeatmapLegendItem shredHeatmapLegendButton"
              data-kind={item.kind}
              data-active={selectedShredKindFilters.has(item.kind)}
              aria-pressed={selectedShredKindFilters.has(item.kind)}
              onClick={this._onLegendFilterButtonClick}
            >
              <span
                className={`shredHeatmapLegendShape ${item.className}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div
          className="shredHeatmapViewport"
          ref={this._viewport}
          style={{ height: viewportHeight }}
        >
          <canvas
            ref={this._canvas}
            className="shredHeatmapCanvas"
            onMouseMove={this._onMouseMove}
            onMouseLeave={this._onMouseLeave}
          />
        </div>
        {!isModifyingSelection && hoveredTarget !== null ? (
          <Tooltip mouseX={mouseX} mouseY={mouseY}>
            <TooltipDetails>
              <TooltipDetail label="Slot">
                {hoveredTarget.segment.slot}
              </TooltipDetail>
              <TooltipDetail label="Time">
                {_formatTimelineHoverTime(
                  hoveredTarget.time,
                  zeroAt,
                  profileTimelineUnit,
                  committedRange,
                  width
                )}
              </TooltipDetail>
              {isSummaryHover && recvSummary !== null ? (
                <>
                  <TooltipDetail label="Received">
                    {recvSummary.normal}
                  </TooltipDetail>
                  <TooltipDetail label="Recovered">
                    {recvSummary.recovered}
                  </TooltipDetail>
                  <TooltipDetail label="Repaired">
                    {recvSummary.repair}
                  </TooltipDetail>
                </>
              ) : (
                <>
                  {hoveredRecvTooltipRows.map((row) => (
                    <TooltipDetail key={row.label} label={row.label}>
                      {row.value}
                    </TooltipDetail>
                  ))}
                  {hoveredTarget.gapEpisode ? (
                    <TooltipDetail label="Gap">
                      {_formatShredIndexRange(
                        hoveredTarget.gapEpisode.startIndex,
                        hoveredTarget.gapEpisode.endIndex
                      )}
                    </TooltipDetail>
                  ) : null}
                </>
              )}
              {hoveredTarget.frontierLine?.kind === 'consumed' ? (
                <TooltipDetail label="Consumed">
                  {hoveredTarget.frontierLine.value}
                </TooltipDetail>
              ) : null}
              {hoveredTarget.frontierLine?.kind === 'highestReceived' ? (
                <TooltipDetail label="Highest received">
                  {hoveredTarget.frontierLine.value}
                </TooltipDetail>
              ) : null}
              {hoveredTarget.frontierLag !== null ? (
                <TooltipDetail label="Catch-up delay">
                  {_formatTimelineDuration(
                    hoveredTarget.frontierLag.delay,
                    profileTimelineUnit,
                    committedRange,
                    width
                  )}
                </TooltipDetail>
              ) : null}
            </TooltipDetails>
          </Tooltip>
        ) : null}
      </div>
    );
  }
}

export const ShredHeatmap = explicitConnect<
  OwnProps,
  StateProps,
  DispatchProps
>({
  mapStateToProps: (state) => ({
    timeRange: getPreviewSelectionRange(state),
    committedRange: getCommittedRange(state),
    heatmap: selectedThreadSelectors.getShredHeatmap(state),
    isModifyingSelection: getPreviewSelectionIsBeingModified(state),
    chartPaddingLeft: TIMELINE_MARGIN_LEFT,
    chartPaddingRight: TIMELINE_MARGIN_RIGHT,
    zeroAt: getZeroAt(state),
    profileTimelineUnit: getProfileTimelineUnit(state),
  }),
  mapDispatchToProps: {
    changeMouseTimePosition,
  },
  component: withSize(ShredHeatmapImpl),
});
