// k-means that gives the same answer every time it sees the same points. ecStat's clustering
// seeds from Math.random without restarting, so a redraw (every sheet save) could split the
// groups differently and renumber them. Here the seeds come from a fixed-seed generator, the
// best of several starts is kept, and clusters are numbered in the order the rows first meet them.

import { seededRandom } from "./random";

export type Point = readonly number[];

const SEED = 0x9e3779b9;
const RESTARTS = 10;
const MAX_ITERATIONS = 100;

const squaredDistance = (a: Point, b: Point): number => a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0);

const nearest = (point: Point, centres: Point[]): { index: number; distance: number } =>
  centres.reduce<{ index: number; distance: number }>(
    (best, centre, index) => {
      const distance = squaredDistance(point, centre);
      return distance < best.distance ? { index, distance } : best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  );

/** k-means++: each next centre is drawn with probability proportional to its squared distance. */
function seedCentres(points: Point[], count: number, random: () => number): Point[] {
  const first = points[Math.floor(random() * points.length)] ?? points[0] ?? [];
  const centres: Point[] = [first];
  while (centres.length < count) {
    const weights = points.map((point) => nearest(point, centres).distance);
    const cumulative = weights.reduce<number[]>((sums, weight) => {
      sums.push((sums[sums.length - 1] ?? 0) + weight);
      return sums;
    }, []);
    const total = cumulative[cumulative.length - 1] ?? 0;
    if (total === 0) break;
    const target = random() * total;
    const picked = cumulative.findIndex((sum) => sum > target);
    centres.push(points[picked === -1 ? points.length - 1 : picked] ?? first);
  }
  return centres;
}

const mean = (points: Point[], dimensions: number): Point =>
  Array.from({ length: dimensions }, (_, dimension) => points.reduce((sum, point) => sum + (point[dimension] ?? 0), 0) / points.length);

interface Clustering {
  labels: number[];
  cost: number;
}

/** Lloyd's iterations from `centres` until the labels stop changing. An emptied cluster keeps its centre. */
function refine(points: Point[], initial: Point[]): Clustering {
  const dimensions = points[0]?.length ?? 0;
  const state = { centres: initial, labels: points.map(() => -1), changed: true, iteration: 0 };
  while (state.changed && state.iteration < MAX_ITERATIONS) {
    const labels = points.map((point) => nearest(point, state.centres).index);
    state.changed = labels.some((label, index) => label !== state.labels[index]);
    state.labels = labels;
    state.centres = state.centres.map((centre, cluster) => {
      const members = points.filter((_, index) => labels[index] === cluster);
      return members.length > 0 ? mean(members, dimensions) : centre;
    });
    state.iteration += 1;
  }
  const cost = points.reduce((sum, point, index) => sum + squaredDistance(point, state.centres[state.labels[index] ?? 0] ?? point), 0);
  return { labels: state.labels, cost };
}

/** Renumbers clusters 0, 1, 2… in the order the points first meet them. */
function numberInOrder(labels: number[]): number[] {
  const order = new Map<number, number>();
  labels.forEach((label) => {
    if (!order.has(label)) order.set(label, order.size);
  });
  return labels.map((label) => order.get(label) ?? 0);
}

/** Each point's cluster, 0 … count-1, the same for the same points on every call. */
export function kMeans(points: Point[], clusterCount: number): number[] {
  if (points.length === 0) return [];
  const count = Math.max(1, Math.min(Math.floor(clusterCount), points.length));
  const random = seededRandom(SEED);
  const best = Array.from({ length: RESTARTS }, () => refine(points, seedCentres(points, count, random))).reduce((kept, candidate) =>
    candidate.cost < kept.cost ? candidate : kept,
  );
  return numberInOrder(best.labels);
}
