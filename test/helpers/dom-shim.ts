/**
 * The Obsidian DOM helpers, on a real DOM.
 *
 * Obsidian extends `Element` with `createDiv`, `createEl`, `setText` and the rest.
 * The existing UI tests grep the SOURCE for these calls, which proves that a line
 * of code exists and nothing about whether anything renders — a test could pass
 * while the element is never created, or created somewhere invisible.
 *
 * This shim implements those helpers on a real DOM so a test can construct a view
 * and inspect what came out: the text, the attributes, the classes, and what a
 * click does. It is deliberately small — only what the plugin actually calls,
 * counted from the source rather than guessed at.
 *
 * It is NOT a browser: there is no layout, so `getBoundingClientRect` returns
 * zeros and anything measured from it is meaningless here. Geometry is checked in
 * the Electron harness instead, where a real engine does the laying out.
 */

/** The subset of the Obsidian element API the plugin uses. */
export interface ObsidianElement extends HTMLElement {
  createDiv(opts?: string | { cls?: string; text?: string; attr?: Record<string, string> }): ObsidianElement;
  createSpan(opts?: string | { cls?: string; text?: string; attr?: Record<string, string> }): ObsidianElement;
  createEl(
    tag: string,
    opts?: { cls?: string; text?: string; attr?: Record<string, string>; type?: string; value?: string; placeholder?: string }
  ): ObsidianElement;
  empty(): void;
  setText(text: string): void;
  addClass(...classes: string[]): void;
  removeClass(...classes: string[]): void;
  hasClass(cls: string): boolean;
  toggleClass(cls: string, on: boolean): void;
  setAttr(key: string, value: string): void;
  getAttr(key: string): string | null;
  appendText(text: string): void;
  detach(): void;
  find(selector: string): ObsidianElement | null;
  findAll(selector: string): ObsidianElement[];
  isShown(): boolean;
  setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
}

/** Apply the attributes from an opts object, whether given as a string or a map. */
function applyOpts(
  el: ObsidianElement,
  opts?: string | { cls?: string; text?: string; attr?: Record<string, string> }
): void {
  if (opts === undefined) return;
  if (typeof opts === "string") {
    if (opts) el.className = opts;
    return;
  }
  if (opts.cls) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attr ?? {})) el.setAttribute(k, v);
}

/**
 * Install the helpers on the given DOM's prototypes.
 *
 * Called with the `document` of whichever DOM is in use, so the shim is not tied
 * to one implementation.
 */
export function installDomHelpers(target: { Element: typeof Element; HTMLElement: typeof HTMLElement }): void {
  const proto = target.Element.prototype as unknown as Record<string, unknown>;
  const htmlProto = target.HTMLElement.prototype as unknown as Record<string, unknown>;

  proto.createEl = function (
    this: ObsidianElement,
    tag: string,
    opts?: { cls?: string; text?: string; attr?: Record<string, string>; type?: string; value?: string; placeholder?: string }
  ) {
    const el = this.ownerDocument.createElement(tag) as ObsidianElement;
    applyOpts(el, opts);
    // `type`, `value` and `placeholder` are written as attributes the way
    // Obsidian does, rather than as properties, so an assertion can read either.
    for (const key of ["type", "value", "placeholder"] as const) {
      const v = opts?.[key];
      if (v !== undefined) el.setAttribute(key, String(v));
    }
    this.appendChild(el);
    return el;
  };

  proto.createDiv = function (this: ObsidianElement, opts?: Parameters<ObsidianElement["createDiv"]>[0]) {
    return this.createEl("div", opts as never);
  };

  proto.createSpan = function (this: ObsidianElement, opts?: Parameters<ObsidianElement["createSpan"]>[0]) {
    return this.createEl("span", opts as never);
  };

  proto.empty = function (this: ObsidianElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  proto.setText = function (this: ObsidianElement, text: string) {
    this.textContent = text;
  };

  proto.addClass = function (this: ObsidianElement, ...classes: string[]) {
    this.classList.add(...classes.filter(Boolean));
  };

  proto.removeClass = function (this: ObsidianElement, ...classes: string[]) {
    this.classList.remove(...classes.filter(Boolean));
  };

  proto.hasClass = function (this: ObsidianElement, cls: string) {
    return this.classList.contains(cls);
  };

  proto.toggleClass = function (this: ObsidianElement, cls: string, on?: boolean) {
    if (on === undefined) this.classList.toggle(cls);
    else this.classList.toggle(cls, on);
  };

  proto.setAttr = function (this: ObsidianElement, key: string, value: string) {
    this.setAttribute(key, value);
  };

  proto.getAttr = function (this: ObsidianElement, key: string) {
    return this.getAttribute(key);
  };

  proto.appendText = function (this: ObsidianElement, text: string) {
    this.appendChild(this.ownerDocument.createTextNode(text));
  };

  proto.detach = function (this: ObsidianElement) {
    this.remove();
  };

  proto.find = function (this: ObsidianElement, selector: string) {
    return this.querySelector(selector) as ObsidianElement | null;
  };

  proto.findAll = function (this: ObsidianElement, selector: string) {
    return [...this.querySelectorAll(selector)] as ObsidianElement[];
  };

  // Layout is absent, so "shown" can only mean "not explicitly hidden". Anything
  // relying on real visibility has to be checked in the Electron harness.
  proto.isShown = function (this: ObsidianElement) {
    return this.style.display !== "none";
  };

  proto.setCssStyles = function (this: ObsidianElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };

  // Custom properties, which `Object.assign` cannot set: they need `setProperty`. The
  // plugin uses this for the tooltip marker the stylesheet reads (`--no-tooltip`).
  proto.setCssProps = function (this: ObsidianElement, props: Record<string, string>) {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  };
  // Obsidian's cross-window-safe type check, which it asks plugin authors to use instead
  // of `instanceof` (an element from a popped-out window is not an instance of THIS
  // window's classes). In one window it is exactly `instanceof`.
  proto.instanceOf = function (this: ObsidianElement, type: unknown) {
    return this instanceof (type as new () => unknown);
  };

  htmlProto.setText = proto.setText;
  htmlProto.empty = proto.empty;

  // Obsidian's element factories are also GLOBAL functions — `createEl("div")` builds a
  // detached element — and the plugin uses them (the linter prefers them to
  // `document.createElement`). Without these the page dies with "createEl is not defined"
  // at the first row of UI and the harness waits for a page that will never finish.
  const win = globalThis as unknown as Record<string, unknown>;
  win.createEl ??= (tag: string, opts?: unknown) => {
    const el = globalThis.document.createElement(tag) as ObsidianElement;
    if (typeof opts === "string") el.setText(opts);
    else if (opts && typeof opts === "object") {
      const o = opts as { cls?: string; text?: string; attr?: Record<string, string> };
      if (o.cls) el.addClass(...String(o.cls).split(/\s+/).filter(Boolean));
      if (o.text) el.setText(o.text);
      for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, String(v));
    }
    return el;
  };
  win.createDiv ??= (opts?: unknown) => (win.createEl as (t: string, o?: unknown) => ObsidianElement)("div", opts);
  win.createSpan ??= (opts?: unknown) => (win.createEl as (t: string, o?: unknown) => ObsidianElement)("span", opts);
  win.createFragment ??= (callback?: (el: DocumentFragment) => void) => {
    const frag = globalThis.document.createDocumentFragment();
    callback?.(frag);
    return frag;
  };
}
