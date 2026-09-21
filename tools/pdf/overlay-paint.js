/**
 * Wab Fit — every object of the edit model, drawn as DOM or SVG.
 *
 * One question is asked here and answered here: given an object and the scale of
 * the page it sits on, what element shows it? Nothing below touches the model,
 * the pointer or the events — overlay.js owns all three.
 *
 * Coordinates are the object's own PDF points: top-left origin, the page as it
 * is DISPLAYED. Everything is placed with a `transform`, which is physical and
 * never mirrors, so a page's own coordinate system is the same in Arabic and in
 * English. The layer this ends up on is LTR for that reason alone.
 *
 * Ink, shapes, whiteout and pictures are one SVG per object whose `viewBox` is
 * the object's own box in points: the model's numbers are read as they are, the
 * stroke widths are in points, and the whole thing stays crisp at any zoom. Text
 * is HTML, because only HTML wraps a line and shapes Arabic correctly.
 *
 * An attribute with nothing behind it is OMITTED, never left `undefined`: a
 * `fill` of "undefined" is a black rectangle nobody asked for.
 */

import { TEXT_LINE_HEIGHT } from './core.js';
import { boxOf } from './overlay-geometry.js';

const NS = 'http://www.w3.org/2000/svg';

/** A picture in the model carries base64, with or without the prefix. */
function source(png) {
  return png.startsWith('data:') ? png : `data:image/png;base64,${png}`;
}

/** The SVG an object is drawn in: its own box in points, sized in CSS pixels. */
function svgOf(box, scale) {
  const width = Math.max(1, box.w);
  const height = Math.max(1, box.h);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + 'pointer-events:none;overflow:visible;'
    + `width:${width * scale}px;height:${height * scale}px;`
    + `transform:translate(${box.x * scale}px,${box.y * scale}px)`;
  return svg;
}

/** An ink stroke's points as a path, shifted into its own box. */
function pathOf(points, box) {
  return points
    .map(([x, y], at) => `${at === 0 ? 'M' : 'L'}${x - box.x} ${y - box.y}`)
    .join(' ');
}

/** An arrow's head: a triangle sitting on the segment's second end. */
function headOf(from, to, shape) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const length = Math.max(6, shape.width * 4);
  const half = length * 0.42;
  const back = [to[0] - Math.cos(angle) * length, to[1] - Math.sin(angle) * length];
  const across = [Math.cos(angle + Math.PI / 2) * half, Math.sin(angle + Math.PI / 2) * half];
  const tip = document.createElementNS(NS, 'polygon');
  tip.setAttribute('points', `${to[0]},${to[1]} ${back[0] + across[0]},${back[1] + across[1]} `
    + `${back[0] - across[0]},${back[1] - across[1]}`);
  tip.setAttribute('fill', shape.stroke);
  return tip;
}

/** An ink stroke, a shape, a whiteout or a picture: one node, in box points. */
function drawn(obj, box) {
  if (obj.kind === 'ink') {
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('d', pathOf(obj.points, box));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', obj.color);
    line.setAttribute('stroke-width', String(obj.width));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    if (obj.opacity < 1) line.setAttribute('opacity', String(obj.opacity));
    return line;
  }
  if (obj.kind === 'whiteout') {
    const cover = document.createElementNS(NS, 'rect');
    cover.setAttribute('width', String(Math.max(1, box.w)));
    cover.setAttribute('height', String(Math.max(1, box.h)));
    cover.setAttribute('fill', obj.color);
    return cover;
  }
  if (obj.kind === 'image') {
    const picture = document.createElementNS(NS, 'image');
    picture.setAttribute('width', String(Math.max(1, box.w)));
    picture.setAttribute('height', String(Math.max(1, box.h)));
    picture.setAttribute('preserveAspectRatio', 'none');
    picture.setAttribute('href', source(obj.pngBase64));
    return picture;
  }
  if (obj.kind === 'rect' || obj.kind === 'ellipse') {
    const shape = document.createElementNS(NS, obj.kind);
    if (obj.kind === 'rect') {
      shape.setAttribute('width', String(Math.max(1, box.w)));
      shape.setAttribute('height', String(Math.max(1, box.h)));
    } else {
      shape.setAttribute('cx', String(box.w / 2));
      shape.setAttribute('cy', String(box.h / 2));
      shape.setAttribute('rx', String(Math.max(0.5, box.w / 2)));
      shape.setAttribute('ry', String(Math.max(0.5, box.h / 2)));
    }
    // A highlight is a shape whose border is an empty string: fill, no outline.
    shape.setAttribute('fill', obj.fill === null || obj.fill === '' ? 'none' : obj.fill);
    shape.setAttribute('stroke', obj.stroke === '' ? 'none' : obj.stroke);
    shape.setAttribute('stroke-width', String(obj.width));
    if (obj.opacity !== undefined && obj.opacity < 1) shape.setAttribute('opacity', String(obj.opacity));
    return shape;
  }
  // A line or an arrow: the box IS the segment, from (x, y) to (x + w, y + h).
  const from = [obj.x - box.x, obj.y - box.y];
  const to = [obj.x + obj.w - box.x, obj.y + obj.h - box.y];
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', String(from[0]));
  line.setAttribute('y1', String(from[1]));
  line.setAttribute('x2', String(to[0]));
  line.setAttribute('y2', String(to[1]));
  line.setAttribute('stroke', obj.stroke === '' ? 'none' : obj.stroke);
  line.setAttribute('stroke-width', String(obj.width));
  line.setAttribute('stroke-linecap', 'round');
  if (obj.opacity !== undefined && obj.opacity < 1) line.setAttribute('opacity', String(obj.opacity));
  if (obj.kind === 'line') return line;
  const group = document.createElementNS(NS, 'g');
  group.append(line, headOf(from, to, obj));
  return group;
}

/** Written text as HTML, because only HTML wraps and joins Arabic letters. */
function textOf(obj, scale) {
  const text = document.createElement('div');
  text.dir = 'auto';
  text.textContent = obj.text;
  text.style.cssText = 'position:absolute;inset-block-start:0;inset-inline-start:0;'
    + 'pointer-events:none;white-space:pre-wrap;overflow:hidden;'
    + `transform:translate(${obj.x * scale}px,${obj.y * scale}px);`
    + `width:${Math.max(1, obj.w) * scale}px;height:${Math.max(1, obj.h) * scale}px;`
    + `font-size:${obj.size * scale}px;line-height:${TEXT_LINE_HEIGHT};`
    + `font-weight:${obj.bold ? 700 : 400};color:${obj.color}`;
  return text;
}

/**
 * One object of the model as an element the overlay can lay on its page. The
 * element carries the object's id, which is how a drag finds it again.
 */
export function elementOf(obj, scale) {
  const element = obj.kind === 'text' ? textOf(obj, scale) : null;
  if (element) {
    element.dataset.id = obj.id;
    return element;
  }
  const box = boxOf(obj);
  const svg = svgOf(box, scale);
  svg.dataset.id = obj.id;
  svg.append(drawn(obj, box));
  return svg;
}
