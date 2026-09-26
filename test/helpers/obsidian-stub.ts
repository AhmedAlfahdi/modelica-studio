/**
 * A stub of the `obsidian` module, for tests that render.
 *
 * The UI tests used to grep the source, which proves a line of code exists and
 * nothing about whether anything renders. These tests instead build the real
 * classes in a real DOM, which needs a real `obsidian` to import — so this
 * provides one.
 *
 * It is deliberately faithful about the parts that matter (the element helpers,
 * `Setting`, `Modal`) and honest about the parts that do not: the vault is an
 * in-memory map, and there is no layout engine, so nothing here can be tested for
 * geometry. That is what the Electron geometry harness is for.
 */

import { installDomHelpers } from "./dom-shim";

/**
 * Install the element helpers as soon as this module loads.
 *
 * Every DOM test imports this stub, so doing it here means a test cannot forget,
 * and the plugin code can call `createDiv` the way it does in the app.
 */
if (typeof document !== "undefined" && !(document.body as unknown as { createDiv?: unknown }).createDiv) {
  installDomHelpers({
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
  });
}

export interface StubFile {
  path: string;
  extension: string;
  basename: string;
}

/** Minimal `TFile`/`TFolder` so `instanceof` checks in the plugin work. */
export class TFile implements StubFile {
  path: string;
  extension: string;
  basename: string;
  constructor(path: string) {
    this.path = path;
    this.extension = path.split(".").pop() ?? "";
    this.basename = path.slice(path.lastIndexOf("/") + 1);
  }
}

export class TFolder {
  path: string;
  children: unknown[] = [];
  constructor(path: string) {
    this.path = path;
  }
}

/** An in-memory vault. Files are stored as text, keyed by path. */
export class StubVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  /** Set to make `trash` throw, for testing the failure path. */
  failTrash = false;
  trashed: string[] = [];

  add(path: string, content = ""): void {
    this.files.set(path, content);
    this.folders.add(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
  }

  getAbstractFileByPath(path: string): unknown {
    if (this.files.has(path)) return new TFile(path);
    if (this.folders.has(path)) return new TFolder(path);
    return null;
  }

  getFiles(): TFile[] {
    return [...this.files.keys()].map((p) => new TFile(p));
  }

  getAllLoadedFiles(): unknown[] {
    return [...this.getFiles(), ...[...this.folders].map((p) => new TFolder(p))];
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? "";
  }

  async create(path: string, content: string): Promise<TFile> {
    this.add(path, content);
    return new TFile(path);
  }

  /**
   * Read-modify-write, as Obsidian's `Vault.process` does it.
   *
   * The plugin writes `.mo` files through this rather than `modify`, so the stub has
   * to offer it: one that only knew `modify` would make every save throw "process is
   * not a function" in the harness while the app itself worked.
   */
  async process(file: TFile, fn: (text: string) => string): Promise<string> {
    const next = fn(this.files.get(file.path) ?? "");
    this.files.set(file.path, next);
    return next;
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async trash(file: TFile, _system: boolean): Promise<void> {
    if (this.failTrash) throw new Error("trash is unavailable");
    this.trashed.push(file.path);
    this.files.delete(file.path);
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  adapter = { getBasePath: () => "/tmp/mst-test-vault" };
}

/** A minimal `Setting`, enough to build and read a settings panel. */
export class Setting {
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  settingEl: HTMLElement;
  components: unknown[] = [];

  constructor(public containerEl: HTMLElement) {
    this.settingEl = containerEl.ownerDocument.createElement("div");
    this.settingEl.className = "setting-item";
    // Exposed so a test can read back what a control holds -- the value of a
    // dropdown, the options it was given, whether a toggle is on.
    (this.settingEl as unknown as { components: unknown[] }).components = this.components;
    (this.settingEl as unknown as { setting: Setting }).setting = this;
    this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string): this {
    this.nameEl.setText(name);
    return this;
  }

  /**
   * A section heading, as Obsidian renders it.
   *
   * The plugin uses this instead of writing an `h2` into the container, which the
   * submission checklist asks for by name. The stub marks the row so a test can find
   * the headings the way a reader sees them.
   */
  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    this.descEl.empty();
    if (typeof desc === "string") this.descEl.setText(desc);
    else this.descEl.appendChild(desc);
    return this;
  }

  setClass(cls: string): this {
    this.settingEl.addClass(cls);
    return this;
  }

  /**
   * Grey a whole row, label and control together.
   *
   * Obsidian's own `setDisabled` marks the row and disables its inputs; the class
   * is what a test reads back, since that is what the user sees.
   */
  setDisabled(disabled: boolean): this {
    this.settingEl.toggleClass("is-disabled", disabled);
    const controls = this.controlEl.querySelectorAll("input, select, textarea");
    for (const el of Array.from(controls)) {
      (el as HTMLInputElement).disabled = disabled;
    }
    return this;
  }

  /** Each `add*` renders a control and keeps it, so a test can read the value. */
  private control<T>(kind: string, build: (el: HTMLElement) => T): this {
    const el = this.controlEl.ownerDocument.createElement("input");
    el.setAttribute("data-control", kind);
    this.controlEl.appendChild(el);
    this.components.push(build(el));
    return this;
  }

  addText(cb: (t: StubText) => unknown): this {
    return this.control("text", (el) => {
      const t = new StubText(el);
      cb(t);
      return t;
    });
  }

  addTextArea(cb: (t: StubText) => unknown): this {
    return this.control("textarea", (el) => {
      const t = new StubText(el);
      cb(t);
      return t;
    });
  }

  addSearch(cb: (t: StubText) => unknown): this {
    return this.control("search", (el) => {
      const t = new StubText(el);
      cb(t);
      return t;
    });
  }

  addToggle(cb: (t: StubToggle) => unknown): this {
    return this.control("toggle", (el) => {
      const t = new StubToggle(el);
      cb(t);
      return t;
    });
  }

  addDropdown(cb: (d: StubDropdown) => unknown): this {
    return this.control("dropdown", (el) => {
      const d = new StubDropdown(el);
      cb(d);
      return d;
    });
  }

  addButton(cb: (b: StubButton) => unknown): this {
    return this.control("button", (el) => {
      const b = new StubButton(el);
      cb(b);
      return b;
    });
  }

  addSlider(cb: (s: StubSlider) => unknown): this {
    return this.control("slider", (el) => {
      const s = new StubSlider(el);
      cb(s);
      return s;
    });
  }

  /**
   * Host a component in the control area.
   *
   * Used for the keychain secret field, which is an Obsidian `SecretComponent`
   * rather than one of the `add*` helpers. Returns `this` so the builder chain
   * continues, which is how the settings code uses it.
   */
  addComponent<T>(cb: (el: HTMLElement) => T): this {
    const el = this.controlEl.ownerDocument.createElement("div");
    this.controlEl.appendChild(el);
    this.components.push(cb(el));
    return this;
  }
}

/** The text-like components share their behaviour. */
export class StubText {
  constructor(public inputEl: HTMLElement) {}
  setPlaceholder(p: string): this {
    this.inputEl.setAttribute("placeholder", p);
    return this;
  }
  setValue(v: string): this {
    this.inputEl.setAttribute("value", v);
    return this;
  }
  getValue(): string {
    return this.inputEl.getAttribute("value") ?? "";
  }
  onChange(cb: (v: string) => unknown): this {
    this.inputEl.addEventListener("change", () => void cb(this.getValue()));
    return this;
  }
}

export class StubToggle {
  value = false;
  constructor(public inputEl: HTMLElement) {}
  setValue(v: boolean): this {
    this.value = v;
    this.inputEl.setAttribute("value", String(v));
    return this;
  }
  onChange(cb: (v: boolean) => unknown): this {
    this.inputEl.addEventListener("change", () => void cb(this.value));
    return this;
  }
}

export class StubDropdown {
  options: Array<[string, string]> = [];
  value = "";
  constructor(public inputEl: HTMLElement) {}
  addOption(id: string, label: string): this {
    this.options.push([id, label]);
    return this;
  }
  setValue(v: string): this {
    this.value = v;
    this.inputEl.setAttribute("value", v);
    return this;
  }
  onChange(cb: (v: string) => unknown): this {
    this.inputEl.addEventListener("change", () => void cb(this.value));
    return this;
  }
}

export class StubButton {
  text = "";
  disabled = false;
  warning = false;
  clicked = 0;
  constructor(public buttonEl: HTMLElement) {}
  setButtonText(t: string): this {
    this.text = t;
    this.buttonEl.setText(t);
    return this;
  }
  setDisabled(d: boolean): this {
    this.disabled = d;
    return this;
  }
  /** Obsidian marks a destructive button with `mod-warning`. */
  setWarning(w = true): this {
    this.warning = w;
    if (w) this.buttonEl.addClass("mod-warning");
    return this;
  }
  setTooltip(t: string): this {
    this.buttonEl.setAttribute("aria-label", t);
    return this;
  }
  setIcon(i: string): this {
    this.buttonEl.setAttribute("data-icon", i);
    return this;
  }
  onClick(cb: () => unknown): this {
    this.buttonEl.addEventListener("click", () => {
      this.clicked++;
      void cb();
    });
    return this;
  }
}

export class StubSlider {
  value = 0;
  /** The limits it was given, so a test can assert the RANGE and not only the value. */
  limits: [number, number, number] | null = null;
  constructor(public inputEl: HTMLElement) {}
  setLimits(min: number, max: number, step: number): this {
    this.limits = [min, max, step];
    return this;
  }
  setValue(v: number): this {
    this.value = v;
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  onChange(cb: (v: number) => unknown): this {
    this.inputEl.addEventListener("change", () => void cb(this.value));
    return this;
  }
}

export class SecretComponent {
  value = "";
  constructor(public app: unknown, public el: HTMLElement) {}
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  onChange(cb: (v: string) => unknown): this {
    this.el.addEventListener("change", () => void cb(this.value));
    return this;
  }
}

/** A modal that renders into a detached element a test can inspect. */
export class Modal {
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  modalEl: HTMLElement;
  opened = false;
  onClose?: () => void;

  constructor(public app: unknown) {
    const doc = globalThis.document;
    this.modalEl = doc.createElement("div");
    this.modalEl.className = "modal";
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
    doc.body.appendChild(this.modalEl);
  }

  open(): void {
    this.opened = true;
    (this as unknown as { onOpen?: () => void }).onOpen?.();
  }

  close(): void {
    this.opened = false;
    (this as unknown as { onClose?: () => void }).onClose?.();
    this.modalEl.detach();
  }
}

export class PluginSettingTab {
  containerEl: HTMLElement;
  constructor(public app: unknown, public plugin: unknown) {
    this.containerEl = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(this.containerEl);
  }
}

/** A menu that records what was added, so a test can invoke an item. */
export class Menu {
  /**
   * Every menu built during a test, in order.
   *
   * A menu is created and shown inside the code under test, so the test has no
   * handle on it: without this, "the button opens a menu holding these two
   * items" is unassertable, and a menu that opened empty would pass.
   */
  static all: Menu[] = [];
  items: Array<{ title: string; icon?: string; run?: () => void }> = [];
  shownAt: MouseEvent | null = null;
  constructor() {
    Menu.all.push(this);
  }
  addItem(cb: (item: StubMenuItem) => unknown): this {
    const item = new StubMenuItem();
    cb(item);
    this.items.push({ title: item.title, icon: item.icon, run: item.run });
    return this;
  }
  showAtMouseEvent(ev: MouseEvent): this {
    this.shownAt = ev;
    return this;
  }
  /** Invoke an item by its title, as clicking it would. */
  click(title: string): boolean {
    const found = this.items.find((i) => i.title.startsWith(title));
    if (!found?.run) return false;
    found.run();
    return true;
  }
}

export class StubMenuItem {
  title = "";
  icon?: string;
  run?: () => void;
  setTitle(t: string): this {
    this.title = t;
    return this;
  }
  setIcon(i: string): this {
    this.icon = i;
    return this;
  }
  onClick(cb: () => unknown): this {
    this.run = () => void cb();
    return this;
  }
}

/**
 * A note's view. The plugin asks it for an editor when a figure is saved into
 * the note at the cursor; a test that never opens one gets undefined, which is
 * the same path as a reading-mode view.
 */
export class MarkdownView {
  editor: unknown = undefined;
}

export class Notice {
  static messages: string[] = [];
  constructor(message: string) {
    Notice.messages.push(String(message));
  }
}

export class AbstractInputSuggest<T> {
  constructor(public app: unknown, public inputEl: HTMLElement) {}
  onSelect(): this {
    return this;
  }
  close(): void {}
  protected getSuggestions(): T[] {
    return [];
  }
}

export const Platform = { isMacOS: false, isMobile: false, isDesktop: true };

/**
 * Put an icon in an element, the way the app does it.
 *
 * This used to be one line — set `data-icon` and stop — and that hid a real bug:
 * the app's own `setIcon` removes the element's FIRST child and appends the new
 * SVG, so a button built as `[icon, label]` becomes `[label, loader]` after one
 * swap, and the swap back then removes the LABEL. The stub's silence about that is
 * why a button ended up with two icons and no word, reported from a screenshot.
 *
 * `data-icon` is still recorded, on the element AND on the svg, because that is
 * what the tests read.
 */
/**
 * The shapes for the icons, when a surface can supply them.
 *
 * Obsidian draws its icons from a table inside the application, which a test cannot
 * read. Without it every icon is an empty `<svg>` -- fine for a test that asserts
 * `data-icon`, and useless for the README's screenshots, which are pictures of the
 * toolbar. `scripts/readme-images.mjs` sets this before the page loads, from the
 * Lucide shapes vendored in `scripts/readme-icons.json`, so the images show the same
 * drawings the app does.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ICON_SVGS__: Record<string, string> | undefined;
}

export function setIcon(el: HTMLElement, icon: string): void {
  const first = el.firstElementChild;
  if (first && first.tagName.toLowerCase() === "svg" && first.getAttribute("data-icon") === icon) {
    return;
  }
  if (el.firstChild) el.removeChild(el.firstChild);
  const svg = el.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `svg-icon lucide-${icon}`);
  svg.setAttribute("data-icon", icon);
  const shapes = globalThis.__ICON_SVGS__?.[icon];
  if (shapes) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = shapes;
  }
  el.appendChild(svg);
  el.setAttribute("data-icon", icon);
}

export function normalizePath(p: string): string {
  return p;
}

/**
 * Obsidian's maths renderer, stood in for.
 *
 * The real one runs MathJax and returns an element holding the typeset formula.
 * Nothing here can typeset, so what comes back is the LaTeX itself, in an element
 * carrying the classes Obsidian uses. That is enough for a test to ask the two
 * questions worth asking — whether the block asked for maths at all, and whether
 * it asked for the right LaTeX — without pulling a typesetter into the harness.
 *
 * Setting `__MATHS_AVAILABLE__` to false makes it fail the way the real one does
 * before MathJax has been loaded: `renderMath` is a two-line wrapper around a
 * lazily loaded global, so it throws `MathJax is not defined`. That failure was
 * once invisible — a `catch` fell back to showing the source and reported nothing
 * anywhere — so it is made testable rather than hoped for.
 */
declare global {
  // eslint-disable-next-line no-var
  var __MATHS_AVAILABLE__: boolean | undefined;
}

export function renderMath(source: string, display: boolean): HTMLElement {
  if (globalThis.__MATHS_AVAILABLE__ === false) {
    throw new ReferenceError("MathJax is not defined");
  }
  const el = document.createElement("span");
  el.className = display ? "math math-block is-loaded" : "math math-inline is-loaded";
  el.setAttribute("data-latex", source);
  el.textContent = source;
  return el;
}

/** Loads the maths engine. The stub can already render, so there is nothing to wait for. */
export function loadMathJax(): Promise<void> {
  return Promise.resolve();
}

/** Flushes the maths stylesheet. Nothing to flush here. */
export function finishRenderMath(): Promise<void> {
  return Promise.resolve();
}

export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests");
}

/**
 * A keymap scope, as Obsidian provides it to a view.
 *
 * Faithful enough to test what a view DOES with it: `register` records the binding, and
 * `trigger` fires it the way the application would. It exists because its absence hid a
 * real bug — Ctrl+S was bound with a DOM listener that Obsidian's own `editor:save-file`
 * command swallowed before it arrived, and no test could see the difference because
 * nothing in the suite could mount a view.
 */
export class Scope {
  private handlers: Array<{ modifiers: string[] | null; key: string | null; func: (ev: unknown, ctx: unknown) => unknown }> = [];

  constructor(public parent?: Scope) {}

  register(modifiers: string[] | null, key: string | null, func: (ev: unknown, ctx: unknown) => unknown) {
    const handler = { modifiers, key, func };
    this.handlers.push(handler);
    return handler;
  }

  unregister(handler: unknown) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  /**
   * Fire the handler bound to this combination, as the application would.
   *
   * `Mod` is translated the way Obsidian documents it — Meta on macOS, Ctrl elsewhere —
   * because a binding registered as `["Mod"]` never matches a raw `["Ctrl"]` otherwise,
   * and the test would report a working shortcut as broken.
   */
  trigger(modifiers: string[], key: string): unknown {
    // Both sides are normalised: a binding registered as ["Mod"] never matches a raw
    // ["Ctrl"], and translating only the caller's side silently reports a working
    // shortcut as missing.
    // A handler's modifiers must all be SATISFIED by the ones pressed. `Mod` is satisfied
    // by either Ctrl or Meta -- the page has no `process.platform` to ask, and a stub
    // that guesses wrong reports a working binding as missing.
    const pressed = modifiers;
    const satisfied = (list: string[]) =>
      list.every((m) => (m === "Mod" ? pressed.includes("Ctrl") || pressed.includes("Meta") : pressed.includes(m)));
    const handler = this.handlers.find((h) => (h.modifiers === null || satisfied(h.modifiers ?? [])) && (h.key === null || h.key === key));
    if (!handler) return "no binding for " + modifiers.join("+") + "+" + key;
    return handler.func({ key, ctrlKey: modifiers.includes("Ctrl"), metaKey: modifiers.includes("Meta") }, {});
  }

  /** Every binding registered here, for a test that wants to assert on them. */
  bindings(): string[] {
    return this.handlers.map((h) => (h.modifiers ?? []).join("+") + "+" + (h.key ?? "*"));
  }
}

export class ItemView {
  scope?: Scope;
  contentEl: HTMLElement = document.createElement("div");
  containerEl: HTMLElement = document.createElement("div");
  private domEvents: Array<{ el: EventTarget; type: string; listener: EventListener; options?: unknown }> = [];

  /** Obsidian's Component.registerDomEvent: attach now, detach when the view closes. */
  registerDomEvent(el: EventTarget, type: string, listener: EventListener, options?: unknown) {
    el.addEventListener(type, listener, options as AddEventListenerOptions);
    this.domEvents.push({ el, type, listener, options });
  }

  registerEvent(): void {}
  addChild(child: { onload?: () => void }): void {
    child.onload?.();
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {
    for (const e of this.domEvents) e.el.removeEventListener(e.type, e.listener, e.options as EventListenerOptions);
    this.domEvents = [];
  }
}
export class WorkspaceLeaf {}
export class Plugin {}
export class App {}
