import { formatAmount } from "@nzosa/core";
import type { Cents } from "@nzosa/core";

/**
 * The two charts a set of books is actually read for.
 *
 * A year of coded transactions answers two questions before any other: what
 * came in and went out each month, and where the money went. Both are already
 * in the profit and loss, and a table of thirty-one accounts is a poor way to
 * see either -- a bad month and a runaway account are shapes, and a column of
 * figures hides shapes well.
 *
 * Drawn by hand in SVG rather than by a charting library. The whole app is one
 * bundle with no runtime dependencies, which is what lets it open from a folder
 * and keeps somebody's bank data off the network, and a chart is not worth
 * giving that up for.
 *
 * The colours are the validated categorical pair rather than the green and red
 * this app uses for money in and out everywhere else. Those two fail a
 * colour-blindness check against each other -- red and green, measured rather
 * than guessed at -- which is survivable on a figure that also carries a minus
 * sign, and is not survivable when the colour is the only thing saying which
 * bar is which.
 */

const AXIS_LEFT = 76;
const AXIS_BOTTOM = 34;
const TOP_ROOM = 22;
const SVG_NS = "http://www.w3.org/2000/svg";

function svgRoot(width: number, height: number): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, "svg");
  element.setAttribute("viewBox", `0 0 ${width} ${height}`);
  element.setAttribute("width", "100%");
  element.setAttribute("role", "img");
  element.classList.add("chart");
  return element;
}

function node<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name) as SVGElementTagNameMap[K];
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/** Axis ticks a person would have chosen: 1, 2, 5 and their powers of ten. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const scaled = rough / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

function ticksTo(max: number, wanted = 4): { top: number; values: number[] } {
  if (max <= 0) return { top: 1, values: [0] };
  const step = niceStep(max / wanted);
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let at = 0; at <= top + step / 2; at += step) values.push(at);
  return { top, values };
}

/** Whole dollars, which is the only precision an axis can actually show. */
function short(dollars: number): string {
  const rounded = Math.round(dollars);
  return Math.abs(rounded) >= 1000
    ? `${Math.round(rounded / 1000)}k`
    : String(rounded);
}

/**
 * One tooltip, moved and refilled.
 *
 * A chart with no hover is a picture of the data rather than a way to read it:
 * the axis rounds, the direct labels are sparing by design, and the exact
 * figure still has to be somewhere that is not a second table.
 */
function hoverLayer(host: HTMLElement): (target: SVGElement, html: string) => void {
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  host.append(tip);

  return (target, html) => {
    target.addEventListener("mouseenter", () => {
      tip.innerHTML = html;
      tip.hidden = false;
    });
    target.addEventListener("mousemove", (event) => {
      const box = host.getBoundingClientRect();
      const at = event as MouseEvent;
      tip.style.left = `${at.clientX - box.left + 14}px`;
      tip.style.top = `${at.clientY - box.top + 14}px`;
    });
    target.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  };
}

/** Escaped, because a payee is somebody's typing and this becomes markup. */
function safe(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MonthPoint {
  label: string;
  income: Cents;
  expenses: Cents;
}

/**
 * Money in and money out, month by month.
 *
 * Two series that have to be told apart, so grouped columns and the
 * categorical pair, with a legend rather than a number on every column.
 */
export function monthlyColumns(
  months: readonly MonthPoint[],
  names: { first: string; second: string; net: boolean } = { first: "Money in", second: "Money out", net: true },
): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";

  const width = 760;
  const height = 300;
  const chart = svgRoot(width, height);
  const plotWidth = width - AXIS_LEFT - 16;
  const plotHeight = height - AXIS_BOTTOM - TOP_ROOM;
  const baseline = TOP_ROOM + plotHeight;

  const biggest = Math.max(0, ...months.map((m) => Math.max(m.income, Math.abs(m.expenses))));
  const { top, values } = ticksTo(biggest / 100);
  const heightOf = (cents: Cents): number =>
    top === 0 ? 0 : (Math.abs(cents) / 100 / top) * plotHeight;

  for (const value of values) {
    const at = baseline - (value / top) * plotHeight;
    chart.append(
      node("line", { x1: AXIS_LEFT, y1: at, x2: AXIS_LEFT + plotWidth, y2: at, class: "chart-grid" }),
    );
    const label = node("text", {
      x: AXIS_LEFT - 10,
      y: at + 4,
      class: "chart-tick",
      "text-anchor": "end",
    });
    label.textContent = short(value);
    chart.append(label);
  }

  const band = plotWidth / Math.max(months.length, 1);
  // Capped rather than filling the band: the leftover is the air that keeps
  // one month readably apart from the next, and the 2px between the pair is
  // the surface gap that separates two touching marks.
  const barWidth = Math.max(3, Math.min(24, (band - 14) / 2));
  const showTip = hoverLayer(wrap);

  months.forEach((month, index) => {
    const middle = AXIS_LEFT + band * index + band / 2;
    const tip =
      `<strong>${safe(month.label)}</strong><br>` +
      `${safe(names.first)} ${formatAmount(month.income)}<br>` +
      `${safe(names.second)} ${formatAmount(Math.abs(month.expenses))}` +
      (names.net ? `<br>Net ${formatAmount(month.income - Math.abs(month.expenses))}` : "");

    const pairs: readonly (readonly [Cents, string])[] = [
      [month.income, "chart-series-1"],
      [month.expenses, "chart-series-2"],
    ];
    pairs.forEach(([amount, className], side) => {
      const tall = heightOf(amount);
      if (tall <= 0) return;
      const x = middle - barWidth - 1 + side * (barWidth + 2);
      const bar = node("path", {
        d: roundedTop(x, baseline - tall, barWidth, tall, 4),
        class: className,
      });
      chart.append(bar);
      showTip(bar, tip);
    });

    const label = node("text", {
      x: middle,
      y: baseline + 20,
      class: "chart-tick",
      "text-anchor": "middle",
    });
    label.textContent = month.label;
    chart.append(label);
  });

  chart.append(
    node("line", {
      x1: AXIS_LEFT,
      y1: baseline,
      x2: AXIS_LEFT + plotWidth,
      y2: baseline,
      class: "chart-axis",
    }),
  );

  wrap.append(
    legend([
      ["chart-series-1", names.first],
      ["chart-series-2", names.second],
    ]),
    chart,
  );
  return wrap;
}

/** A column with its data end rounded and its foot square on the baseline. */
function roundedTop(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return (
    `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} ` +
    `L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} ` +
    `L ${x + width} ${y + height} Z`
  );
}

/** A bar with its data end rounded and its foot square on the baseline. */
function roundedEnd(x: number, y: number, width: number, height: number, radius: number): string {
  if (width <= 0) return "";
  const r = Math.max(0, Math.min(radius, width, height / 2));
  return (
    `M ${x} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} ` +
    `L ${x + width} ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height} ` +
    `L ${x} ${y + height} Z`
  );
}

function legend(items: readonly (readonly [string, string])[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "chart-legend";
  for (const [className, label] of items) {
    const item = document.createElement("span");
    item.className = "chart-legend-item";
    const swatch = document.createElement("span");
    swatch.className = `chart-swatch ${className}`;
    item.append(swatch, document.createTextNode(label));
    box.append(item);
  }
  return box;
}

export interface RankedItem {
  label: string;
  value: Cents;
}

/**
 * Where the money went: the accounts that took the most of it.
 *
 * One series, so one colour. Length already carries the magnitude, and shading
 * each bar by its own size would spend the only free channel restating what
 * the chart has already said. No legend either: with one colour, the heading
 * above it is the legend.
 */
export function rankedBars(items: readonly RankedItem[]): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";
  if (items.length === 0) return wrap;

  const rowHeight = 30;
  const width = 760;
  const chart = svgRoot(width, items.length * rowHeight + 16);
  const labelRoom = 250;
  const valueRoom = 96;
  const plotWidth = width - labelRoom - valueRoom;
  const biggest = Math.max(...items.map((i) => Math.abs(i.value)));
  const showTip = hoverLayer(wrap);

  items.forEach((item, index) => {
    const y = index * rowHeight + 8;
    const long = biggest === 0 ? 0 : (Math.abs(item.value) / biggest) * plotWidth;

    const name = node("text", {
      x: labelRoom - 12,
      y: y + 15,
      class: "chart-name",
      "text-anchor": "end",
    });
    // Measured against the room there is rather than clipped by it.
    name.textContent = item.label.length > 32 ? `${item.label.slice(0, 31)}…` : item.label;
    chart.append(name);

    const bar = node("path", { d: roundedEnd(labelRoom, y + 2, long, 16, 4), class: "chart-series-1" });
    chart.append(bar);
    showTip(bar, `<strong>${safe(item.label)}</strong><br>${formatAmount(Math.abs(item.value))}`);

    // At the tip: where a bar's value goes, and where its own mark cannot clip it.
    const value = node("text", { x: labelRoom + long + 10, y: y + 15, class: "chart-value" });
    value.textContent = formatAmount(Math.abs(item.value));
    chart.append(value);
  });

  wrap.append(chart);
  return wrap;
}

/**
 * The headline figures, which are not a chart.
 *
 * Three numbers do not need three bars: a bar chart of income, expenses and
 * net is a picture of something a person reads faster as three numbers.
 */
export function statTiles(
  tiles: readonly { label: string; value: Cents; note?: string }[],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "chart-tiles";
  for (const tile of tiles) {
    const box = document.createElement("div");
    box.className = "chart-tile";
    const label = document.createElement("span");
    label.className = "chart-tile-label";
    label.textContent = tile.label;
    const value = document.createElement("strong");
    value.className = "chart-tile-value";
    value.textContent = formatAmount(tile.value);
    box.append(label, value);
    if (tile.note !== undefined) {
      const note = document.createElement("span");
      note.className = "chart-tile-note";
      note.textContent = tile.note;
      box.append(note);
    }
    row.append(box);
  }
  return row;
}

/** Two balances over time, such as what customers owe and what is owed to suppliers. */
export interface LinePoint {
  label: string;
  first: Cents;
  second: Cents;
}

/**
 * Two balances, month end by month end.
 *
 * Lines rather than columns: these are balances on a day, not amounts over a
 * month, and a line says "this is where it stood, then here" where a column
 * says "this much happened". Straight segments between the month ends, not a
 * smoothed curve: a curve draws values on days nobody measured.
 */
export function lineChart(points: readonly LinePoint[], names: { first: string; second: string }): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";
  const width = 760;
  const height = 260;
  const chart = svgRoot(width, height);
  const plotWidth = width - AXIS_LEFT - 24;
  const plotHeight = height - AXIS_BOTTOM - TOP_ROOM;
  const baseline = TOP_ROOM + plotHeight;

  const biggest = Math.max(0, ...points.map((p) => Math.max(Math.abs(p.first), Math.abs(p.second))));
  const { top, values } = ticksTo(biggest / 100);
  const yOf = (cents: Cents): number => (top === 0 ? baseline : baseline - (Math.max(0, cents) / 100 / top) * plotHeight);
  for (const value of values) {
    const at = baseline - (value / top) * plotHeight;
    chart.append(node("line", { x1: AXIS_LEFT, y1: at, x2: AXIS_LEFT + plotWidth, y2: at, class: "chart-grid" }));
    const label = node("text", { x: AXIS_LEFT - 10, y: at + 4, class: "chart-tick", "text-anchor": "end" });
    label.textContent = short(value);
    chart.append(label);
  }

  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const xOf = (index: number): number => AXIS_LEFT + (points.length > 1 ? step * index : plotWidth / 2);
  const showTip = hoverLayer(wrap);
  const series: readonly (readonly ["first" | "second", string, string])[] = [
    ["first", "chart-line-1", "chart-series-1"],
    ["second", "chart-line-2", "chart-series-2"],
  ];
  for (const [key, lineClass] of series) {
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(p[key]).toFixed(1)}`).join(" ");
    if (points.length > 1) chart.append(node("path", { d, class: lineClass }));
  }
  points.forEach((point, index) => {
    const tip =
      `<strong>${safe(point.label)}</strong><br>` +
      `${safe(names.first)} ${formatAmount(point.first)}<br>${safe(names.second)} ${formatAmount(point.second)}`;
    for (const [key, , dotClass] of series) {
      const dot = node("circle", { cx: xOf(index), cy: yOf(point[key]), r: 4, class: dotClass });
      chart.append(dot);
      showTip(dot, tip);
    }
    const label = node("text", { x: xOf(index), y: baseline + 20, class: "chart-tick", "text-anchor": "middle" });
    label.textContent = point.label;
    chart.append(label);
  });
  chart.append(node("line", { x1: AXIS_LEFT, y1: baseline, x2: AXIS_LEFT + plotWidth, y2: baseline, class: "chart-axis" }));

  wrap.append(
    legend([
      ["chart-series-1", names.first],
      ["chart-series-2", names.second],
    ]),
    chart,
  );
  return wrap;
}

/** One part of a whole, for a ring. `series` is 1 to 5, a chart-series class. */
export interface RingSlice {
  label: string;
  value: Cents;
  series: 1 | 2 | 3 | 4 | 5;
  /** Shown beside the amount in the legend, such as a count. */
  note?: string;
}

/**
 * Parts of a whole, as a ring with its legend beside it.
 *
 * A ring rather than a pie for a few parts of one total: the hole carries the
 * total. The legend carries every amount, so no part is read from its colour
 * or its angle alone.
 */
export function ringChart(slices: readonly RingSlice[], centre: string): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure chart-ring";
  const size = 200;
  const chart = svgRoot(size, size);
  chart.setAttribute("width", String(size));
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const outer = 92;
  const inner = 58;
  const middle = size / 2;
  const showTip = hoverLayer(wrap);
  const point = (radius: number, turn: number): [number, number] => [
    middle + radius * Math.sin(turn * 2 * Math.PI),
    middle - radius * Math.cos(turn * 2 * Math.PI),
  ];
  let from = 0;
  for (const slice of slices) {
    if (slice.value <= 0 || total === 0) continue;
    const share = slice.value / total;
    // A whole ring cannot be drawn as one arc: stop just short of it.
    const to = from + Math.min(share, 0.9999);
    const [x1, y1] = point(outer, from);
    const [x2, y2] = point(outer, to);
    const [x3, y3] = point(inner, to);
    const [x4, y4] = point(inner, from);
    const large = to - from > 0.5 ? 1 : 0;
    const path = node("path", {
      d:
        `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} ` +
        `L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`,
      class: `chart-series-${slice.series}`,
    });
    chart.append(path);
    showTip(path, `<strong>${safe(slice.label)}</strong><br>${formatAmount(slice.value)}${slice.note ? ` (${safe(slice.note)})` : ""}`);
    from += share;
  }
  if (total === 0) chart.append(node("circle", { cx: middle, cy: middle, r: (outer + inner) / 2, class: "chart-grid", fill: "none", "stroke-width": outer - inner }));
  const label = node("text", { x: middle, y: middle + 5, class: "chart-ring-centre", "text-anchor": "middle" });
  label.textContent = centre;
  chart.append(label);

  const key = document.createElement("ul");
  key.className = "chart-ring-key";
  for (const slice of slices) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `chart-swatch chart-series-${slice.series}`;
    const amount = document.createElement("strong");
    amount.textContent = formatAmount(slice.value);
    item.append(swatch, document.createTextNode(` ${slice.label} `), amount);
    if (slice.note) item.append(document.createTextNode(` (${slice.note})`));
    key.append(item);
  }
  wrap.append(chart, key);
  return wrap;
}

/** Ticks spanning a range that may go below zero, in whole units, zero always among them. */
function ticksBetween(low: number, high: number, wanted = 5): { low: number; high: number; values: number[] } {
  const lo = Math.min(0, low);
  const hi = Math.max(0, high);
  if (hi - lo <= 0) return { low: 0, high: 1, values: [0] };
  const step = niceStep((hi - lo) / wanted);
  const bottom = Math.floor(lo / step) * step;
  const top = Math.ceil(hi / step) * step;
  const values: number[] = [];
  for (let at = bottom; at <= top + step / 2; at += step) values.push(Math.round(at * 1e6) / 1e6);
  return { low: bottom, high: top, values };
}

/** Two amounts and a rate for one month. */
export interface RatePoint {
  label: string;
  first: Cents;
  second: Cents;
  /** A share, 0.25 for 25%; null where there is none (no income that month). */
  rate: number | null;
}

/**
 * Two amounts a month as columns, and a rate as a line on its own scale.
 *
 * The rate's scale is on the right, labelled in percent, and starts and ends
 * where the rates do rather than at 0 and 100: a margin moving between -30%
 * and 35% drawn on a 0-100 scale would be a flat line along the floor. Where a
 * month has no rate the line breaks rather than inventing one.
 */
export function columnsWithRate(points: readonly RatePoint[], names: { first: string; second: string; rate: string }): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";
  const width = 760;
  const height = 300;
  const right = 56;
  const chart = svgRoot(width, height);
  const plotWidth = width - AXIS_LEFT - right;
  const plotHeight = height - AXIS_BOTTOM - TOP_ROOM;
  const baseline = TOP_ROOM + plotHeight;

  const biggest = Math.max(0, ...points.map((p) => Math.max(Math.abs(p.first), Math.abs(p.second))));
  const { top, values } = ticksTo(biggest / 100);
  const heightOf = (cents: Cents): number => (top === 0 ? 0 : (Math.abs(cents) / 100 / top) * plotHeight);
  for (const value of values) {
    const at = baseline - (value / top) * plotHeight;
    chart.append(node("line", { x1: AXIS_LEFT, y1: at, x2: AXIS_LEFT + plotWidth, y2: at, class: "chart-grid" }));
    const label = node("text", { x: AXIS_LEFT - 10, y: at + 4, class: "chart-tick", "text-anchor": "end" });
    label.textContent = short(value);
    chart.append(label);
  }

  // The rate's own scale, on the right, in whole percent.
  const rates = points.map((p) => p.rate).filter((r): r is number => r !== null).map((r) => r * 100);
  const scale = ticksBetween(Math.min(0, ...rates), Math.max(0, ...rates), 4);
  const rateY = (percent: number): number => TOP_ROOM + ((scale.high - percent) / (scale.high - scale.low)) * plotHeight;
  for (const value of scale.values) {
    const label = node("text", { x: AXIS_LEFT + plotWidth + 8, y: rateY(value) + 4, class: "chart-tick", "text-anchor": "start" });
    label.textContent = `${Math.round(value)}%`;
    chart.append(label);
  }
  if (scale.low < 0) {
    chart.append(
      node("line", { x1: AXIS_LEFT, y1: rateY(0), x2: AXIS_LEFT + plotWidth, y2: rateY(0), class: "chart-zero", "stroke-dasharray": "4 4" }),
    );
  }

  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(3, Math.min(22, (band - 14) / 2));
  const showTip = hoverLayer(wrap);
  let path = "";
  let pen = false;
  points.forEach((point, index) => {
    const middle = AXIS_LEFT + band * index + band / 2;
    const tip =
      `<strong>${safe(point.label)}</strong><br>${safe(names.first)} ${formatAmount(point.first)}<br>` +
      `${safe(names.second)} ${formatAmount(Math.abs(point.second))}<br>` +
      `${safe(names.rate)} ${point.rate === null ? "none" : `${Math.round(point.rate * 1000) / 10}%`}`;
    const pairs: readonly (readonly [Cents, string])[] = [
      [point.first, "chart-series-1"],
      [point.second, "chart-cat-4"],
    ];
    pairs.forEach(([amount, className], side) => {
      const tall = heightOf(amount);
      if (tall <= 0) return;
      const bar = node("path", {
        d: roundedTop(middle - barWidth - 1 + side * (barWidth + 2), baseline - tall, barWidth, tall, 4),
        class: className,
      });
      chart.append(bar);
      showTip(bar, tip);
    });
    if (point.rate === null) {
      pen = false;
    } else {
      path += `${pen ? "L" : "M"} ${middle.toFixed(1)} ${rateY(point.rate * 100).toFixed(1)} `;
      pen = true;
    }
    const label = node("text", { x: middle, y: baseline + 20, class: "chart-tick", "text-anchor": "middle" });
    label.textContent = point.label;
    chart.append(label);
  });
  if (path !== "") chart.append(node("path", { d: path, class: "chart-line-rate" }));
  points.forEach((point, index) => {
    if (point.rate === null) return;
    const dot = node("circle", { cx: AXIS_LEFT + band * index + band / 2, cy: rateY(point.rate * 100), r: 3.5, class: "chart-dot-rate" });
    chart.append(dot);
    showTip(dot, `<strong>${safe(point.label)}</strong><br>${safe(names.rate)} ${Math.round(point.rate * 1000) / 10}%`);
  });
  chart.append(node("line", { x1: AXIS_LEFT, y1: baseline, x2: AXIS_LEFT + plotWidth, y2: baseline, class: "chart-axis" }));

  wrap.append(
    legend([
      ["chart-series-1", names.first],
      ["chart-cat-4", names.second],
      ["chart-line-swatch", names.rate],
    ]),
    chart,
  );
  return wrap;
}

/** One month's amount in each series, by series name; a missing series is nothing. */
export interface StackPoint {
  label: string;
  parts: ReadonlyMap<string, Cents>;
}

/**
 * Each month as one column made of its parts, such as income by account.
 *
 * `series` is the order to stack and colour them in, the largest first; one
 * named "Others" is grey. A part below zero (a gain posted to an expense
 * account) stacks downward from the baseline rather than being dropped, so the
 * column still adds up to the month's total.
 */
export function stackedColumns(months: readonly StackPoint[], series: readonly string[]): HTMLElement {
  const wrap = document.createElement("figure");
  wrap.className = "chart-figure";
  const width = 760;
  const height = 300;
  const chart = svgRoot(width, height);
  const plotWidth = width - AXIS_LEFT - 16;
  const plotHeight = height - AXIS_BOTTOM - TOP_ROOM;

  const ups = months.map((m) => [...m.parts.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0));
  const downs = months.map((m) => [...m.parts.values()].filter((v) => v < 0).reduce((s, v) => s + v, 0));
  const scale = ticksBetween(Math.min(0, ...downs) / 100, Math.max(0, ...ups) / 100, 4);
  const yOf = (dollars: number): number => TOP_ROOM + ((scale.high - dollars) / (scale.high - scale.low)) * plotHeight;
  for (const value of scale.values) {
    const at = yOf(value);
    chart.append(node("line", { x1: AXIS_LEFT, y1: at, x2: AXIS_LEFT + plotWidth, y2: at, class: value === 0 ? "chart-axis" : "chart-grid" }));
    const label = node("text", { x: AXIS_LEFT - 10, y: at + 4, class: "chart-tick", "text-anchor": "end" });
    label.textContent = short(value);
    chart.append(label);
  }

  const classOf = (name: string, index: number): string => (name === "Others" ? "chart-cat-others" : `chart-cat-${(index % 9) + 1}`);
  const band = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.max(4, Math.min(34, band - 16));
  const showTip = hoverLayer(wrap);
  months.forEach((month, index) => {
    const x = AXIS_LEFT + band * index + (band - barWidth) / 2;
    let up = 0;
    let down = 0;
    const total = [...month.parts.values()].reduce((s, v) => s + v, 0);
    series.forEach((name, which) => {
      const cents = month.parts.get(name) ?? 0;
      if (cents === 0) return;
      const from = cents > 0 ? up : down;
      const to = from + cents / 100;
      if (cents > 0) up = to;
      else down = to;
      const y = Math.min(yOf(from), yOf(to));
      const tall = Math.abs(yOf(from) - yOf(to));
      if (tall < 0.2) return;
      const rect = node("rect", { x, y, width: barWidth, height: tall, class: classOf(name, which) });
      chart.append(rect);
      showTip(rect, `<strong>${safe(month.label)}</strong><br>${safe(name)} ${formatAmount(cents)}<br>Month in all ${formatAmount(total)}`);
    });
    const label = node("text", { x: x + barWidth / 2, y: TOP_ROOM + plotHeight + 20, class: "chart-tick", "text-anchor": "middle" });
    label.textContent = month.label;
    chart.append(label);
  });

  wrap.append(legend(series.map((name, index) => [classOf(name, index), name] as const)), chart);
  return wrap;
}
