/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Provider } from 'react-redux';

import {
  act,
  fireEvent,
  render,
} from 'firefox-profiler/test/fixtures/testing-library';
import { ShredHeatmap } from '../../components/shred-heatmap';
import { changeSelectedTab } from '../../actions/app';
import {
  commitRange,
  updatePreviewSelection,
} from '../../actions/profile-view';
import {
  getCommittedRange,
  getPreviewSelectionRange,
  getProfileTimelineUnit,
  getZeroAt,
} from '../../selectors/profile';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import {
  TIMELINE_MARGIN_LEFT,
  TIMELINE_MARGIN_RIGHT,
} from '../../app-logic/constants';
import { getFormattedTimelineValue } from '../../profile-logic/committed-ranges';
import {
  autoMockCanvasContext,
  flushDrawLog,
} from '../fixtures/mocks/canvas-context';
import { autoMockElementSize } from '../fixtures/mocks/element-size';
import { mockRaf } from '../fixtures/mocks/request-animation-frame';
import { storeWithProfile } from '../fixtures/stores';
import {
  addRootOverlayElement,
  removeRootOverlayElement,
} from '../fixtures/utils';
import { getShredTrackProfile } from '../fixtures/profiles/processed-profile';
import type { Store } from 'redux';
import type { ShredHeatmapSegment } from '../../profile-logic/shreds';

autoMockCanvasContext();
autoMockElementSize({ width: 480, height: 320 });

const HEATMAP_PLOT_PADDING_TOP = 10;
const HEATMAP_PLOT_PADDING_BOTTOM = 10;
const HEATMAP_MIN_PLOT_HEIGHT = 96;
const HEATMAP_MAX_PLOT_HEIGHT = 640;
const HEATMAP_PIXELS_PER_INDEX = 0.2;

beforeEach(addRootOverlayElement);
afterEach(removeRootOverlayElement);

describe('ShredHeatmap', function () {
  it('renders the synthetic shred heatmap', () => {
    const { container } = setup();
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders the shred heatmap legend', () => {
    const { container, getByLabelText } = setup();

    expect(getByLabelText('Shred heatmap legend')).toBeInTheDocument();
    expect(
      container.querySelector('.shredHeatmapLegendTitle')?.textContent
    ).toBe('Turbine layers');
    expect(
      Array.from(container.querySelectorAll('.shredHeatmapLegendItem')).map(
        (item) => item.textContent
      )
    ).toEqual([
      'Root',
      'L1',
      'L2',
      'L3',
      'Recovered',
      'Repaired',
      'Data',
      'Coding',
    ]);
  });

  it('filters visible recv ranges by the selected recv filters', () => {
    const { getByRole, flushRafCalls } = setup();
    flushDrawLog();

    const rootButton = getByRole('button', { name: 'Root' });
    const l1Button = getByRole('button', { name: 'L1' });
    const recoveredButton = getByRole('button', { name: 'Recovered' });
    const repairedButton = getByRole('button', { name: 'Repaired' });

    fireEvent.click(rootButton);
    fireEvent.click(l1Button);
    fireEvent.click(recoveredButton);
    flushRafCalls();

    expect(rootButton).toHaveAttribute('aria-pressed', 'true');
    expect(l1Button).toHaveAttribute('aria-pressed', 'true');
    expect(recoveredButton).toHaveAttribute('aria-pressed', 'true');
    let drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set fillStyle', '#f59e0b']);
    expect(drawLog).toContainEqual(['set fillStyle', '#ff2da6']);
    expect(drawLog).toContainEqual(['set fillStyle', '#007aff']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#8b5cf6']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#16a34a']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#d70022']);

    fireEvent.click(rootButton);
    flushRafCalls();

    expect(rootButton).toHaveAttribute('aria-pressed', 'false');
    expect(l1Button).toHaveAttribute('aria-pressed', 'true');
    expect(recoveredButton).toHaveAttribute('aria-pressed', 'true');
    drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set fillStyle', '#ff2da6']);
    expect(drawLog).toContainEqual(['set fillStyle', '#007aff']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#f59e0b']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#8b5cf6']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#16a34a']);

    fireEvent.click(l1Button);
    fireEvent.click(recoveredButton);
    fireEvent.click(repairedButton);
    flushRafCalls();

    expect(l1Button).toHaveAttribute('aria-pressed', 'false');
    expect(recoveredButton).toHaveAttribute('aria-pressed', 'false');
    expect(repairedButton).toHaveAttribute('aria-pressed', 'true');
    drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set fillStyle', '#d70022']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#f59e0b']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#ff2da6']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#007aff']);
  });

  it('filters visible recv ranges by shred kind', () => {
    const { getByRole, flushRafCalls } = setup();
    flushDrawLog();

    const dataButton = getByRole('button', { name: 'Data' });
    const codingButton = getByRole('button', { name: 'Coding' });

    fireEvent.click(dataButton);
    flushRafCalls();

    expect(dataButton).toHaveAttribute('aria-pressed', 'true');
    expect(codingButton).toHaveAttribute('aria-pressed', 'false');
    let drawLog = flushDrawLog();
    expect(drawLog.some((entry) => entry[0] === 'arc')).toBe(true);
    expect(drawLog.some((entry) => entry[0] === 'closePath')).toBe(false);

    fireEvent.click(dataButton);
    fireEvent.click(codingButton);
    flushRafCalls();

    expect(dataButton).toHaveAttribute('aria-pressed', 'false');
    expect(codingButton).toHaveAttribute('aria-pressed', 'true');
    drawLog = flushDrawLog();
    expect(drawLog.some((entry) => entry[0] === 'closePath')).toBe(true);
    expect(drawLog.some((entry) => entry[0] === 'arc')).toBe(false);
  });

  it('combines turbine layer and shred kind filters', () => {
    const { getByRole, flushRafCalls } = setup();
    flushDrawLog();

    const rootButton = getByRole('button', { name: 'Root' });
    const codingButton = getByRole('button', { name: 'Coding' });

    fireEvent.click(rootButton);
    fireEvent.click(codingButton);
    flushRafCalls();

    expect(rootButton).toHaveAttribute('aria-pressed', 'true');
    expect(codingButton).toHaveAttribute('aria-pressed', 'true');
    const drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set fillStyle', '#f59e0b']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#d70022']);
    expect(drawLog).not.toContainEqual(['set fillStyle', '#ff2da6']);
    expect(drawLog.some((entry) => entry[0] === 'closePath')).toBe(true);
    expect(drawLog.some((entry) => entry[0] === 'arc')).toBe(false);
  });

  it('draws receive cells and frontier overlays', () => {
    setup();
    expect(flushDrawLog()).toMatchSnapshot();
  });

  it('renders received shreds as point markers', () => {
    setup();
    expect(flushDrawLog().some((entry) => entry[0] === 'arc')).toBe(true);
  });

  it('renders coding receive shreds as diamond markers', () => {
    setup();
    expect(flushDrawLog().some((entry) => entry[0] === 'closePath')).toBe(true);
  });

  it('uses heat intensity to distinguish recv batch sizes', () => {
    setup();
    const globalAlphaValues = flushDrawLog()
      .filter((entry) => entry[0] === 'set globalAlpha')
      .map((entry) => Number(entry[1]))
      .filter((value) => value < 1);

    expect(globalAlphaValues.length).toBeGreaterThan(0);
    expect(Math.max(...globalAlphaValues)).toBeGreaterThan(
      Math.min(...globalAlphaValues)
    );
  });

  it('keeps turbine layer colors opaque enough to stay distinct', () => {
    setup();
    const globalAlphaValues = flushDrawLog()
      .filter((entry) => entry[0] === 'set globalAlpha')
      .map((entry) => Number(entry[1]))
      .filter((value) => value < 1);

    expect(globalAlphaValues.length).toBeGreaterThan(0);
    expect(Math.min(...globalAlphaValues)).toBeGreaterThanOrEqual(0.68);
  });

  it('renders root receive ranges with the root layer color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#f59e0b']);
  });

  it('renders l1 receive ranges with the l1 layer color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#ff2da6']);
  });

  it('renders l2 receive ranges with the l2 layer color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#8b5cf6']);
  });

  it('renders l3 receive ranges with the l3 layer color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#16a34a']);
  });

  it('renders repair receive ranges with the repair color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#d70022']);
  });

  it('renders recovered receive ranges with the recovered color', () => {
    setup();
    expect(flushDrawLog()).toContainEqual(['set fillStyle', '#007aff']);
  });

  it('draws repair recv points after the frontier overlays', () => {
    setup();
    expect(_repairPointsDrawAfterFrontiers(flushDrawLog())).toBe(true);
  });

  it('keeps single-shred repairs visually prominent', () => {
    setup();
    const drawLog = flushDrawLog();
    const recvAlphaValues = drawLog
      .filter((entry) => entry[0] === 'set globalAlpha')
      .map((entry) => Number(entry[1]))
      .filter((value) => value < 1);

    expect(Math.max(...recvAlphaValues)).toBeGreaterThanOrEqual(0.7);
    expect(drawLog).toContainEqual(['set strokeStyle', '#d70022']);
    expect(drawLog).toContainEqual(['set lineWidth', 1.5]);
  });

  it('re-renders when the committed range changes', () => {
    const { store, flushRafCalls } = setup();
    flushDrawLog();
    const initialHeatmap = selectedThreadSelectors.getShredHeatmap(
      store.getState()
    );
    const targetSegment = initialHeatmap.bands.flat()[1];
    if (!targetSegment) {
      throw new Error('Expected a second shred segment in the fixture.');
    }
    const selectionStart = targetSegment.start + 10;
    const selectionEnd = targetSegment.end + 40;

    act(() => {
      store.dispatch(commitRange(selectionStart, selectionEnd));
    });
    flushRafCalls();

    expect(flushDrawLog()).not.toHaveLength(0);

    const previewRange = getPreviewSelectionRange(store.getState());
    const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
    const targetSegmentAfterCommit = heatmap.bands
      .flat()
      .find((segment) => segment.slot === targetSegment.slot);
    expect(targetSegmentAfterCommit?.start).toBeLessThan(previewRange.start);
    expect(targetSegmentAfterCommit?.end).toBeGreaterThan(previewRange.start);
    expect(
      targetSegmentAfterCommit?.frontierSamples.some(
        (sample) => sample.time < previewRange.start
      )
    ).toBe(true);
  });

  it('adjusts to the preview selection while it is being modified', () => {
    const { store, flushRafCalls, container } = setup();
    flushDrawLog();

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart: 350,
          selectionEnd: 960,
        })
      );
    });
    flushRafCalls();

    expect(
      container.querySelector('.shredHeatmapSummary')
    ).not.toBeInTheDocument();
    expect(flushDrawLog()).not.toHaveLength(0);
  });

  it('keeps timeline padding for preview selections', () => {
    const { store, flushRafCalls } = setup();
    flushDrawLog();

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart: 350,
          selectionEnd: 960,
        })
      );
    });
    flushRafCalls();

    expect(_getMinimumNonNegativeSegmentX(flushDrawLog())).toBeGreaterThan(
      TIMELINE_MARGIN_LEFT
    );
  });

  it('slides the slot envelope smoothly within the padded preview viewport', () => {
    const { store, flushRafCalls } = setup();
    flushDrawLog();

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart: 0,
          selectionEnd: 200,
        })
      );
    });
    flushRafCalls();

    const firstSelectionX = _getMinimumSegmentX(flushDrawLog());

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart: 10,
          selectionEnd: 200,
        })
      );
    });
    flushRafCalls();

    const shiftedSelectionX = _getMinimumSegmentX(flushDrawLog());
    expect(shiftedSelectionX).toBeLessThan(firstSelectionX);
    expect(firstSelectionX).toBeGreaterThanOrEqual(TIMELINE_MARGIN_LEFT);
  });

  it('keeps one recv batch of context on each side of the selected range', () => {
    const { store } = setup();
    const heatmapBeforeSelection = selectedThreadSelectors.getShredHeatmap(
      store.getState()
    );
    const targetSegment = heatmapBeforeSelection.bands.flat()[0];
    if (!targetSegment || targetSegment.recvRanges.length < 5) {
      throw new Error(
        'Expected a populated first shred segment in the fixture.'
      );
    }
    const selectionStart = targetSegment.recvRanges[2].time;
    const selectionEnd =
      targetSegment.recvRanges[targetSegment.recvRanges.length - 3].time;

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart,
          selectionEnd,
        })
      );
    });

    const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
    const targetSegmentAfterSelection = heatmap.bands
      .flat()
      .find((segment) => segment.slot === targetSegment.slot);

    expect(
      targetSegmentAfterSelection?.recvRanges.some(
        (recvRange) => recvRange.time < selectionStart
      )
    ).toBe(true);
  });

  it('draws committed zoomed ranges with timeline padding', () => {
    const { store, flushRafCalls } = setup();
    flushDrawLog();

    act(() => {
      store.dispatch(commitRange(350, 960));
    });
    flushRafCalls();

    expect(_getMinimumNonNegativeSegmentX(flushDrawLog())).toBeGreaterThan(
      TIMELINE_MARGIN_LEFT
    );
  });

  it('keeps slot context at preview range boundaries', () => {
    const { store } = setup();
    const heatmapBeforeSelection = selectedThreadSelectors.getShredHeatmap(
      store.getState()
    );
    const targetSegment = heatmapBeforeSelection.bands.flat()[1];
    if (!targetSegment || targetSegment.frontierSamples.length === 0) {
      throw new Error('Expected a second shred segment with frontier samples.');
    }
    const selectionStart =
      targetSegment.frontierSamples[
        Math.floor(targetSegment.frontierSamples.length / 2)
      ].time;
    const selectionEnd = targetSegment.end;

    act(() => {
      store.dispatch(
        updatePreviewSelection({
          isModifying: true,
          selectionStart,
          selectionEnd,
        })
      );
    });

    const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
    const targetSegmentAfterSelection = heatmap.bands
      .flat()
      .find((segment) => segment.slot === targetSegment.slot);

    expect(targetSegmentAfterSelection?.start).toBeLessThan(selectionStart);
    expect(targetSegmentAfterSelection?.end).toBeGreaterThan(selectionStart);
    expect(
      targetSegmentAfterSelection?.frontierSamples.some(
        (sample) => sample.time < selectionStart
      )
    ).toBe(true);
  });

  it('changes the mouse time position when the mouse moves', () => {
    const { store, container } = setup();

    expect(
      store.getState().profileView.viewOptions.mouseTimePosition
    ).toBeNull();

    const canvas = _getCanvas(container);

    fireEvent.mouseMove(canvas, {
      clientX: 200,
      clientY: 80,
      pageX: 200,
      pageY: 80,
    });

    const mouseTimePositionAfterFirstMove =
      store.getState().profileView.viewOptions.mouseTimePosition;
    expect(typeof mouseTimePositionAfterFirstMove).toBe('number');

    fireEvent.mouseMove(canvas, {
      clientX: 280,
      clientY: 80,
      pageX: 280,
      pageY: 80,
    });

    expect(store.getState().profileView.viewOptions.mouseTimePosition).not.toBe(
      mouseTimePositionAfterFirstMove
    );

    fireEvent.mouseLeave(canvas);
    expect(
      store.getState().profileView.viewOptions.mouseTimePosition
    ).toBeNull();
  });

  it('allocates more vertical space for dense shred bands', () => {
    const { container } = setup();
    const canvas = _getCanvas(container);

    expect(canvas.height).toBeGreaterThan(150);
  });

  it('does not show the compressed hover index bucket in the tooltip', () => {
    const { container, getByText, queryByText } = setup();
    const firstSegmentX = _getMinimumNonNegativeSegmentX(flushDrawLog());
    const canvas = _getCanvas(container);

    fireEvent.mouseMove(canvas, {
      clientX: firstSegmentX + 10,
      clientY: 60,
      pageX: firstSegmentX + 10,
      pageY: 60,
    });

    expect(getByText('Slot:')).toBeInTheDocument();
    expect(queryByText('Index:')).not.toBeInTheDocument();
  });

  it('shows per-source slot totals when hovering slot background', () => {
    const { container, store } = setup();
    flushDrawLog();
    const canvas = _getCanvas(container);
    const hoverTarget = _getPlainSlotHoverTarget(store);
    const summary = _getRecvSummaryForTest(hoverTarget.segment);

    fireEvent.mouseMove(canvas, {
      clientX: hoverTarget.x,
      clientY: hoverTarget.y,
      pageX: hoverTarget.x,
      pageY: hoverTarget.y,
    });

    expect(document.body).toHaveTextContent(`Slot:${hoverTarget.segment.slot}`);
    expect(document.body).toHaveTextContent(`Received:${summary.normal}`);
    expect(document.body).toHaveTextContent(`Recovered:${summary.recovered}`);
    expect(document.body).toHaveTextContent(`Repaired:${summary.repair}`);
    expect(document.body).not.toHaveTextContent('Receive source:');
    expect(document.body).not.toHaveTextContent('Received shreds:');
  });

  it('highlights the hovered recv point', () => {
    const { container, store, flushRafCalls } = setup();
    flushDrawLog();
    const canvas = _getCanvas(container);
    const hoverTarget = _getRecvHoverTarget(store);

    fireEvent.mouseMove(canvas, {
      clientX: hoverTarget.x,
      clientY: hoverTarget.y,
      pageX: hoverTarget.x,
      pageY: hoverTarget.y,
    });
    flushRafCalls();

    expect(document.body).toHaveTextContent(`${hoverTarget.label}:`);
    expect(document.body).toHaveTextContent(hoverTarget.value);
    expect(flushDrawLog()).toContainEqual(['set lineWidth', 2.5]);
  });

  it('shows all recv sources in the hovered 1ms time bucket', () => {
    const { container, store, flushRafCalls } = setup();
    flushDrawLog();
    const canvas = _getCanvas(container);
    const hoverTarget = _getMultiRecvHoverTarget(store);

    fireEvent.mouseMove(canvas, {
      clientX: hoverTarget.x,
      clientY: hoverTarget.y,
      pageX: hoverTarget.x,
      pageY: hoverTarget.y,
    });
    flushRafCalls();

    for (const row of hoverTarget.rows) {
      expect(document.body).toHaveTextContent(`${row.label}:`);
      expect(document.body).toHaveTextContent(row.value);
    }
    expect(hoverTarget.rows.length).toBeGreaterThan(1);
  });

  it('sorts shred indexes ascending inside tooltip rows', () => {
    expect(
      _getHoveredRecvTooltipRowsForTest([
        {
          markerIndex: 3,
          time: 10,
          slot: 1,
          startIndex: 9,
          endIndex: 10,
          source: 'turbine',
          shredKind: 'data',
          turbineLayer: 'root',
        },
        {
          markerIndex: 1,
          time: 10,
          slot: 1,
          startIndex: 2,
          endIndex: 4,
          source: 'turbine',
          shredKind: 'data',
          turbineLayer: 'root',
        },
        {
          markerIndex: 2,
          time: 10,
          slot: 1,
          startIndex: 7,
          endIndex: 7,
          source: 'turbine',
          shredKind: 'data',
          turbineLayer: 'root',
        },
      ])
    ).toEqual([
      {
        label: 'Root data',
        value: '2..4, 7, 9..10 (6)',
      },
    ]);
  });

  it('formats the tooltip time the same way as the timeline ruler hover', () => {
    const { container, store } = setup();
    const firstSegmentX = _getMinimumNonNegativeSegmentX(flushDrawLog());
    const canvas = _getCanvas(container);

    fireEvent.mouseMove(canvas, {
      clientX: firstSegmentX + 10,
      clientY: 60,
      pageX: firstSegmentX + 10,
      pageY: 60,
    });

    const state = store.getState();
    const mouseTimePosition = state.profileView.viewOptions.mouseTimePosition;
    if (mouseTimePosition === null) {
      throw new Error(
        'Expected a mouse time position after hovering the heatmap.'
      );
    }

    const committedRange = getCommittedRange(state);
    const expectedTime = getFormattedTimelineValue(
      mouseTimePosition - getZeroAt(state),
      getProfileTimelineUnit(state),
      (committedRange.end - committedRange.start) / 480
    );

    expect(document.body).toHaveTextContent(expectedTime);
  });

  it('shows the consumed frontier value when hovering the green line', () => {
    const { container, store, flushRafCalls } = setup();
    flushDrawLog();
    const canvas = _getCanvas(container);
    const hoverTarget = _getFrontierHoverTarget(store, 'consumed');

    fireEvent.mouseMove(canvas, {
      clientX: hoverTarget.x,
      clientY: hoverTarget.y,
      pageX: hoverTarget.x,
      pageY: hoverTarget.y,
    });
    flushRafCalls();

    expect(document.body).toHaveTextContent('Consumed:');
    expect(document.body).toHaveTextContent(String(hoverTarget.value));
    expect(document.body).toHaveTextContent('Catch-up delay:');
    expect(document.body).toHaveTextContent(hoverTarget.delayLabel);
    const drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set lineWidth', 3]);
    expect(drawLog).toContainEqual(['setLineDash', [6, 3]]);
  });

  it('shows the highest received frontier value when hovering that line', () => {
    const { container, store, flushRafCalls } = setup();
    flushDrawLog();
    const canvas = _getCanvas(container);
    const hoverTarget = _getFrontierHoverTarget(store, 'highestReceived');

    fireEvent.mouseMove(canvas, {
      clientX: hoverTarget.x,
      clientY: hoverTarget.y,
      pageX: hoverTarget.x,
      pageY: hoverTarget.y,
    });
    flushRafCalls();

    expect(document.body).toHaveTextContent('Highest received:');
    expect(document.body).toHaveTextContent(String(hoverTarget.value));
    expect(document.body).toHaveTextContent('Catch-up delay:');
    expect(document.body).toHaveTextContent(hoverTarget.delayLabel);
    const drawLog = flushDrawLog();
    expect(drawLog).toContainEqual(['set lineWidth', 3]);
    expect(drawLog).toContainEqual(['setLineDash', [6, 3]]);
  });

  it('uses the viewport width for time scaling when a scrollbar narrows the plot', () => {
    const { container, store, flushRafCalls } = setup();
    flushDrawLog();

    const viewport = container.querySelector('.shredHeatmapViewport');
    if (!(viewport instanceof HTMLDivElement)) {
      throw new Error('Expected the shred heatmap viewport to exist.');
    }

    Object.defineProperty(viewport, 'clientWidth', {
      configurable: true,
      get: () => 432,
    });

    act(() => {
      store.dispatch(commitRange(350, 960));
    });
    flushRafCalls();

    const backgroundFill = flushDrawLog().find(
      (entry) => entry[0] === 'fillRect' && entry[1] === 0 && entry[2] === 0
    );
    expect(backgroundFill?.[3]).toBe(432);
  });
});

function setup() {
  const flushRafCalls = mockRaf();
  const profile = getShredTrackProfile();
  const store = storeWithProfile(profile);
  store.dispatch(changeSelectedTab('shred-heatmap'));

  const renderResult = render(
    <Provider store={store}>
      <ShredHeatmap />
    </Provider>
  );

  flushRafCalls();

  return {
    ...renderResult,
    store,
    flushRafCalls,
  };
}

function _getMinimumSegmentX(drawLog: unknown[][]): number {
  const segmentRects = _getSegmentFillRects(drawLog);
  if (segmentRects.length === 0) {
    throw new Error('Expected at least one shred segment fill rect.');
  }

  return Math.min(...segmentRects.map((entry) => Number(entry[1])));
}

function _getMinimumNonNegativeSegmentX(drawLog: unknown[][]): number {
  const segmentRects = _getSegmentFillRects(drawLog).filter(
    (entry) => Number(entry[1]) >= 0
  );
  if (segmentRects.length === 0) {
    throw new Error('Expected at least one visible shred segment fill rect.');
  }

  return Math.min(...segmentRects.map((entry) => Number(entry[1])));
}

function _getSegmentFillRects(drawLog: unknown[][]): unknown[][] {
  const segmentFillStyles = new Set([
    'rgb(0 0 0 / 0.025)',
    'rgba(0, 0, 0, 0.025)',
  ]);
  const segmentRects: unknown[][] = [];
  let currentFillStyle = '';

  for (const entry of drawLog) {
    if (entry[0] === 'set fillStyle') {
      currentFillStyle = String(entry[1]);
      continue;
    }

    if (entry[0] === 'fillRect' && segmentFillStyles.has(currentFillStyle)) {
      segmentRects.push(entry);
    }
  }

  return segmentRects;
}

function _repairPointsDrawAfterFrontiers(drawLog: unknown[][]): boolean {
  const segmentFillStyles = new Set([
    'rgb(0 0 0 / 0.025)',
    'rgba(0, 0, 0, 0.025)',
  ]);
  const segments: unknown[][][] = [];
  let currentFillStyle = '';
  let currentSegmentStart = -1;

  for (let i = 0; i < drawLog.length; i++) {
    const entry = drawLog[i];
    if (entry[0] === 'set fillStyle') {
      currentFillStyle = String(entry[1]);
      continue;
    }
    if (entry[0] === 'fillRect' && segmentFillStyles.has(currentFillStyle)) {
      if (currentSegmentStart !== -1) {
        segments.push(drawLog.slice(currentSegmentStart, i));
      }
      currentSegmentStart = i;
    }
  }
  if (currentSegmentStart !== -1) {
    segments.push(drawLog.slice(currentSegmentStart));
  }

  return segments.every((segmentOps) => {
    const lastFrontierStrokeStyleIndex = segmentOps.reduce(
      (lastIndex, entry, index) => {
        if (
          entry[0] === 'set strokeStyle' &&
          (entry[1] === 'rgba(0, 200, 0, 0.5)' || entry[1] === '#8f5b00')
        ) {
          return index;
        }
        return lastIndex;
      },
      -1
    );
    const repairFillIndex = segmentOps.reduce((lastIndex, entry, index) => {
      if (entry[0] === 'set fillStyle' && entry[1] === '#d70022') {
        return index;
      }
      return lastIndex;
    }, -1);

    if (repairFillIndex === -1 || lastFrontierStrokeStyleIndex === -1) {
      return true;
    }

    return repairFillIndex > lastFrontierStrokeStyleIndex;
  });
}

function _getCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector('.shredHeatmapCanvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Expected the shred heatmap canvas to exist.');
  }

  return canvas;
}

function _getFrontierHoverTarget(
  store: Store,
  kind: 'consumed' | 'highestReceived'
): { x: number; y: number; value: number; delayLabel: string } {
  const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
  const timeRange = getPreviewSelectionRange(store.getState());
  const otherKind = kind === 'consumed' ? 'highestReceived' : 'consumed';
  let bandTop = 0;

  for (const band of heatmap.bands) {
    const bandMaxIndex = Math.max(
      1,
      ...band.map((segment) => segment.maxIndex)
    );
    const plotHeight = _getPlotHeight(bandMaxIndex);

    for (const segment of band) {
      const hoverTarget = _findFrontierHoverTargetInSegment(
        segment,
        bandTop,
        plotHeight,
        timeRange,
        kind,
        otherKind
      );
      if (hoverTarget !== null) {
        const delay = _getFrontierLagForTest(segment, hoverTarget.value);
        if (delay === null) {
          continue;
        }

        const state = store.getState();
        return {
          ...hoverTarget,
          delayLabel: getFormattedTimelineValue(
            delay,
            getProfileTimelineUnit(state),
            (getCommittedRange(state).end - getCommittedRange(state).start) /
              480
          ),
        };
      }
    }

    bandTop +=
      HEATMAP_PLOT_PADDING_TOP + plotHeight + HEATMAP_PLOT_PADDING_BOTTOM;
  }

  throw new Error(
    `Could not find a hover target for the ${kind} frontier line.`
  );
}

function _getRecvHoverTarget(store: Store): {
  x: number;
  y: number;
  label: string;
  value: string;
} {
  const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
  const timeRange = getPreviewSelectionRange(store.getState());
  let bandTop = 0;

  for (const band of heatmap.bands) {
    const bandMaxIndex = Math.max(
      1,
      ...band.map((segment) => segment.maxIndex)
    );
    const plotHeight = _getPlotHeight(bandMaxIndex);

    for (const segment of band) {
      const recvRange = segment.recvRanges[0];
      if (!recvRange) {
        continue;
      }

      const hoveredRecvRanges = _getHoveredRecvRangesForPoint(
        segment,
        bandTop,
        plotHeight,
        timeRange,
        _scaleTimelineTimeForTest(recvRange.time, timeRange),
        _scaleIndexToYForTest(
          recvRange.startIndex + (_getRecvCountForTest(recvRange) - 1) / 2,
          segment.maxIndex,
          bandTop,
          plotHeight
        )
      );
      const [row] = _getHoveredRecvTooltipRowsForTest(hoveredRecvRanges);
      if (!row) {
        continue;
      }

      return {
        x: _scaleTimelineTimeForTest(recvRange.time, timeRange),
        y: _scaleIndexToYForTest(
          recvRange.startIndex + (_getRecvCountForTest(recvRange) - 1) / 2,
          segment.maxIndex,
          bandTop,
          plotHeight
        ),
        label: row.label,
        value: row.value,
      };
    }

    bandTop +=
      HEATMAP_PLOT_PADDING_TOP + plotHeight + HEATMAP_PLOT_PADDING_BOTTOM;
  }

  throw new Error('Could not find a recv hover target.');
}

function _getMultiRecvHoverTarget(store: Store): {
  x: number;
  y: number;
  rows: Array<{ label: string; value: string }>;
} {
  const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
  const timeRange = getPreviewSelectionRange(store.getState());
  let bandTop = 0;

  for (const band of heatmap.bands) {
    const bandMaxIndex = Math.max(
      1,
      ...band.map((segment) => segment.maxIndex)
    );
    const plotHeight = _getPlotHeight(bandMaxIndex);

    for (const segment of band) {
      for (const recvRange of segment.recvRanges) {
        const x = _scaleTimelineTimeForTest(recvRange.time, timeRange);
        const y = _scaleIndexToYForTest(
          recvRange.startIndex + (_getRecvCountForTest(recvRange) - 1) / 2,
          segment.maxIndex,
          bandTop,
          plotHeight
        );
        const hoveredRecvRanges = _getHoveredRecvRangesForPoint(
          segment,
          bandTop,
          plotHeight,
          timeRange,
          x,
          y
        );
        const rows = _getHoveredRecvTooltipRowsForTest(hoveredRecvRanges);
        if (rows.length > 1) {
          return { x, y, rows };
        }
      }
    }

    bandTop +=
      HEATMAP_PLOT_PADDING_TOP + plotHeight + HEATMAP_PLOT_PADDING_BOTTOM;
  }

  throw new Error('Could not find an overlapping recv hover target.');
}

function _getPlainSlotHoverTarget(store: Store): {
  x: number;
  y: number;
  segment: ShredHeatmapSegment;
} {
  const heatmap = selectedThreadSelectors.getShredHeatmap(store.getState());
  const timeRange = getPreviewSelectionRange(store.getState());
  let bandTop = 0;

  for (const band of heatmap.bands) {
    const bandMaxIndex = Math.max(
      1,
      ...band.map((segment) => segment.maxIndex)
    );
    const plotHeight = _getPlotHeight(bandMaxIndex);

    for (const segment of band) {
      const left = _scaleTimelineTimeForTest(segment.start, timeRange);
      const right = _scaleTimelineTimeForTest(segment.end, timeRange);
      const minX = Math.ceil(Math.min(left, right) + 8);
      const maxX = Math.floor(Math.max(left, right) - 8);
      const minY = Math.ceil(bandTop + HEATMAP_PLOT_PADDING_TOP + 8);
      const maxY = Math.floor(
        bandTop + HEATMAP_PLOT_PADDING_TOP + plotHeight - 8
      );

      for (let x = minX; x <= maxX; x += 6) {
        for (let y = minY; y <= maxY; y += 6) {
          if (
            _isPlainSlotHoverPoint(
              segment,
              bandTop,
              plotHeight,
              timeRange,
              x,
              y
            )
          ) {
            return { x, y, segment };
          }
        }
      }
    }

    bandTop +=
      HEATMAP_PLOT_PADDING_TOP + plotHeight + HEATMAP_PLOT_PADDING_BOTTOM;
  }

  throw new Error('Could not find a plain slot hover target.');
}

function _findFrontierHoverTargetInSegment(
  segment: ShredHeatmapSegment,
  bandTop: number,
  plotHeight: number,
  timeRange: { start: number; end: number },
  kind: 'consumed' | 'highestReceived',
  otherKind: 'consumed' | 'highestReceived'
): { x: number; y: number; value: number } | null {
  if (segment.frontierSamples.length < 2) {
    return null;
  }

  for (let i = 0; i < segment.frontierSamples.length - 1; i++) {
    const current = segment.frontierSamples[i];
    const next = segment.frontierSamples[i + 1];
    const value = current[kind];
    const otherValue = current[otherKind];
    const x = _scaleTimelineTimeForTest(
      (current.time + next.time) / 2,
      timeRange
    );
    const y = _scaleIndexToYForTest(
      value,
      segment.maxIndex,
      bandTop,
      plotHeight
    );

    if (
      value !== otherValue &&
      _getFrontierLagForTest(segment, value) !== null
    ) {
      return { x, y, value };
    }
  }

  const lastSample =
    segment.frontierSamples[segment.frontierSamples.length - 1];
  if (
    lastSample[kind] === lastSample[otherKind] ||
    _getFrontierLagForTest(segment, lastSample[kind]) === null
  ) {
    return null;
  }

  return {
    x: _scaleTimelineTimeForTest(
      (lastSample.time + segment.end) / 2,
      timeRange
    ),
    y: _scaleIndexToYForTest(
      lastSample[kind],
      segment.maxIndex,
      bandTop,
      plotHeight
    ),
    value: lastSample[kind],
  };
}

function _isPlainSlotHoverPoint(
  segment: ShredHeatmapSegment,
  bandTop: number,
  plotHeight: number,
  timeRange: { start: number; end: number },
  x: number,
  y: number
): boolean {
  for (const recvRange of segment.recvRanges) {
    const recvX = _scaleTimelineTimeForTest(recvRange.time, timeRange);
    const recvY = _scaleIndexToYForTest(
      recvRange.startIndex + (_getRecvCountForTest(recvRange) - 1) / 2,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const recvRadius = _getRecvRadiusForTest(recvRange);
    if (
      _getRecvHitDistanceForTest(recvRange, recvX, recvY, x, y, recvRadius) !==
      null
    ) {
      return false;
    }
  }

  for (const gapEpisode of segment.gapEpisodes) {
    const gapLeft = _scaleTimelineTimeForTest(gapEpisode.start, timeRange);
    const gapRight = _scaleTimelineTimeForTest(gapEpisode.end, timeRange);
    const gapTop = _scaleIndexToYForTest(
      gapEpisode.endIndex,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const gapBottom = _scaleIndexToYForTest(
      gapEpisode.startIndex,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    if (
      x >= Math.min(gapLeft, gapRight) &&
      x <= Math.max(gapLeft, gapRight) &&
      y >= Math.min(gapTop, gapBottom) - 2 &&
      y <= Math.max(gapTop, gapBottom) + 2
    ) {
      return false;
    }
  }

  const time = _timeFromXForTest(x, timeRange);
  const frontierValues = _getFrontierValuesAtTime(segment, time);
  if (frontierValues !== null) {
    const consumedY = _scaleIndexToYForTest(
      frontierValues.consumed,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const highestReceivedY = _scaleIndexToYForTest(
      frontierValues.highestReceived,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    if (Math.abs(y - consumedY) <= 4 || Math.abs(y - highestReceivedY) <= 4) {
      return false;
    }
  }

  return true;
}

function _getFrontierValuesAtTime(
  segment: ShredHeatmapSegment,
  time: number
): { consumed: number; highestReceived: number } | null {
  if (segment.frontierSamples.length === 0) {
    return null;
  }

  let activeSample = segment.frontierSamples[0];
  for (const sample of segment.frontierSamples) {
    if (sample.time > time) {
      break;
    }
    activeSample = sample;
  }

  return {
    consumed: activeSample.consumed,
    highestReceived: activeSample.highestReceived,
  };
}

function _getFrontierReachTimeForTest(
  segment: ShredHeatmapSegment,
  kind: 'consumed' | 'highestReceived',
  value: number
): number | null {
  for (const sample of segment.frontierSamples) {
    if (sample[kind] >= value) {
      return sample.time;
    }
  }

  return null;
}

function _getFrontierLagForTest(
  segment: ShredHeatmapSegment,
  value: number
): number | null {
  const highestReceivedTime = _getFrontierReachTimeForTest(
    segment,
    'highestReceived',
    value
  );
  const consumedTime = _getFrontierReachTimeForTest(segment, 'consumed', value);

  if (
    highestReceivedTime === null ||
    consumedTime === null ||
    consumedTime <= highestReceivedTime
  ) {
    return null;
  }

  return consumedTime - highestReceivedTime;
}

function _getRecvSummaryForTest(segment: ShredHeatmapSegment): {
  normal: number;
  repair: number;
  recovered: number;
} {
  return segment.recvRanges.reduce(
    (summary, recvRange) => {
      const count = _getRecvCountForTest(recvRange);
      if (recvRange.source === 'repair') {
        summary.repair += count;
      } else if (recvRange.source === 'recovered') {
        summary.recovered += count;
      } else {
        summary.normal += count;
      }
      return summary;
    },
    { normal: 0, repair: 0, recovered: 0 }
  );
}

function _getRecvCountForTest(recvRange: {
  startIndex: number;
  endIndex: number;
}): number {
  return recvRange.endIndex - recvRange.startIndex + 1;
}

function _getHoveredRecvRangesForPoint(
  segment: ShredHeatmapSegment,
  bandTop: number,
  plotHeight: number,
  timeRange: { start: number; end: number },
  x: number,
  y: number
): Array<ShredHeatmapSegment['recvRanges'][number]> {
  let nearestRecvRange:
    | (ShredHeatmapSegment['recvRanges'][number] & { distance: number })
    | null = null;

  for (const recvRange of segment.recvRanges) {
    const recvX = _scaleTimelineTimeForTest(recvRange.time, timeRange);
    const recvY = _scaleIndexToYForTest(
      recvRange.startIndex + (_getRecvCountForTest(recvRange) - 1) / 2,
      segment.maxIndex,
      bandTop,
      plotHeight
    );
    const recvRadius = _getRecvRadiusForTest(recvRange);
    const distance = _getRecvHitDistanceForTest(
      recvRange,
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
      nearestRecvRange = { ...recvRange, distance };
    }
  }

  if (nearestRecvRange === null) {
    return [];
  }

  return segment.recvRanges.filter(
    (recvRange) =>
      _getRecvTimeBucketForTest(recvRange.time) ===
      _getRecvTimeBucketForTest(nearestRecvRange.time)
  );
}

function _getHoveredRecvTooltipRowsForTest(
  recvRanges: ReadonlyArray<ShredHeatmapSegment['recvRanges'][number]>
): Array<{ label: string; value: string }> {
  const rows = [
    {
      label: 'Root',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.turbineLayer === 'root'
      ),
    },
    {
      label: 'L1',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.turbineLayer === 'l1'
      ),
    },
    {
      label: 'L2',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.turbineLayer === 'l2'
      ),
    },
    {
      label: 'L3',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.turbineLayer === 'l3'
      ),
    },
    {
      label: 'Received',
      recvRanges: recvRanges.filter(
        (recvRange) =>
          (recvRange.source === 'normal' || recvRange.source === 'turbine') &&
          !recvRange.turbineLayer
      ),
    },
    {
      label: 'Recovered',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.source === 'recovered'
      ),
    },
    {
      label: 'Repaired',
      recvRanges: recvRanges.filter(
        (recvRange) => recvRange.source === 'repair'
      ),
    },
  ];

  return rows.flatMap((row) =>
    (['data', 'code'] as const).flatMap((shredKind) => {
      const kindRecvRanges = _sortRecvRangesAscendingForTest(
        row.recvRanges.filter((recvRange) => recvRange.shredKind === shredKind)
      );
      if (kindRecvRanges.length === 0) {
        return [];
      }

      return [
        {
          label: `${row.label} ${_getShredKindLabelForTest(shredKind)}`,
          value: `${kindRecvRanges
            .map((recvRange) =>
              recvRange.startIndex === recvRange.endIndex
                ? String(recvRange.startIndex)
                : `${recvRange.startIndex}..${recvRange.endIndex}`
            )
            .join(', ')} (${kindRecvRanges.reduce(
            (count, recvRange) => count + _getRecvCountForTest(recvRange),
            0
          )})`,
        },
      ];
    })
  );
}

function _sortRecvRangesAscendingForTest<
  T extends {
    markerIndex: number;
    time: number;
    startIndex: number;
    endIndex: number;
  },
>(recvRanges: ReadonlyArray<T>): T[] {
  return [...recvRanges].sort(
    (a, b) =>
      a.startIndex - b.startIndex ||
      a.endIndex - b.endIndex ||
      a.time - b.time ||
      a.markerIndex - b.markerIndex
  );
}

function _getShredKindLabelForTest(shredKind: 'data' | 'code'): string {
  return shredKind === 'code' ? 'coding' : 'data';
}

function _getRecvHitDistanceForTest(
  recvRange: ShredHeatmapSegment['recvRanges'][number],
  recvX: number,
  recvY: number,
  x: number,
  y: number,
  recvRadius: number
): number | null {
  const dx = Math.abs(recvX - x);
  const dy = Math.abs(recvY - y);
  const boundary = recvRadius + 4;

  if (recvRange.shredKind === 'code') {
    const distance = dx + dy;
    return distance <= boundary ? distance : null;
  }

  const distance = Math.hypot(dx, dy);
  return distance <= boundary ? distance : null;
}

function _getRecvRadiusForTest(recvRange: {
  startIndex: number;
  endIndex: number;
}): number {
  const count = Math.max(1, Math.min(_getRecvCountForTest(recvRange), 100));
  const heatWeight = Math.log(count) / Math.log(100);
  return 2 + heatWeight * (5 - 2);
}

function _getRecvTimeBucketForTest(time: number): number {
  return Math.floor(time);
}

function _timeFromXForTest(
  x: number,
  range: { start: number; end: number }
): number {
  const drawableWidth = 480 - TIMELINE_MARGIN_LEFT - TIMELINE_MARGIN_RIGHT;
  return (
    range.start +
    ((x - TIMELINE_MARGIN_LEFT) / drawableWidth) * (range.end - range.start)
  );
}

function _getPlotHeight(maxIndex: number): number {
  return Math.min(
    Math.max(
      Math.ceil(maxIndex * HEATMAP_PIXELS_PER_INDEX),
      HEATMAP_MIN_PLOT_HEIGHT
    ),
    HEATMAP_MAX_PLOT_HEIGHT
  );
}

function _scaleTimelineTimeForTest(
  time: number,
  range: { start: number; end: number }
): number {
  const drawableWidth = 480 - TIMELINE_MARGIN_LEFT - TIMELINE_MARGIN_RIGHT;
  return (
    TIMELINE_MARGIN_LEFT +
    ((time - range.start) / (range.end - range.start)) * drawableWidth
  );
}

function _scaleIndexToYForTest(
  index: number,
  maxIndex: number,
  bandTop: number,
  plotHeight: number
): number {
  const normalized = maxIndex <= 1 ? 0 : (index - 1) / (maxIndex - 1);
  return bandTop + HEATMAP_PLOT_PADDING_TOP + (1 - normalized) * plotHeight;
}
