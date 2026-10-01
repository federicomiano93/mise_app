// form-dom.mjs — a DOM just complete enough to EXECUTE the ingredient card (buildIngredientForm)
// under node --test: elements, attributes, events, <select> options and their value, <input> value
// and checked, hidden. Same idea as the small DOMs in tests/orders-edit-ingredient.test.mjs and
// tests/inventory-list-rows.test.mjs, grown to hold a whole form.
//
// ⚠️ IT IS NOT A BROWSER. It proves what the card DECIDES — what it sends, what it refuses, what it
// shows and hides — not how anything looks; layout is the ui-check skill's job.

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => n && this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on) this.add(name); else this.remove(name); return this.contains(name); }
}

export class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.classList = new ClassList();
    this._text = null;
    this._value = undefined;
    this._hidden = undefined;
    this._selected = undefined;
    this.checked = false;
    this.disabled = false;
    this.focused = 0;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList = new ClassList(); this.classList.add(...String(value).split(/\s+/)); }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { this._text = ''; this._html = value; }

  get hidden() { return this._hidden !== undefined ? this._hidden : ('hidden' in this.attributes); }
  set hidden(value) { this._hidden = Boolean(value); }

  // <option selected>: the card sets `opt.selected = true`, and el() sets the attribute — one meaning.
  get selected() { return 'selected' in this.attributes; }
  set selected(on) { if (on) this.attributes.selected = 'true'; else delete this.attributes.selected; }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }

  appendChild(child) { child.parentNode = this; this._text = null; this.children.push(child); return child; }
  insertBefore(child, ref) {
    child.parentNode = this;
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
    return child;
  }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  replaceChildren() { this.children = []; this._text = null; }
  focus() { this.focused += 1; }
  // The card asks the help-button module to fill its «?» hosts; this fake has no selector engine and no help.
  querySelectorAll() { return []; }
  querySelector() { return null; }

  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn({ target: this, detail: 1, ...event })); }

  // <select> and <option>
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get _optionValue() { return this.attributes.value !== undefined ? this.attributes.value : this.textContent; }
  get value() {
    if (this.tagName === 'OPTION') return this._optionValue;
    if (this.tagName === 'SELECT') {
      const options = this.options;
      if (!options.length) return '';
      const picked = this._selected !== undefined ? options[this._selected]
        : (options.find(o => 'selected' in o.attributes) || options[0]);
      return picked ? picked._optionValue : '';
    }
    return this._value !== undefined ? this._value : (this.attributes.value !== undefined ? this.attributes.value : '');
  }
  set value(next) {
    if (this.tagName === 'SELECT') {
      const at = this.options.findIndex(o => o._optionValue === String(next));
      this._selected = at < 0 ? undefined : at;
      return;
    }
    this._value = String(next);
  }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

export function installDom() {
  globalThis.document = {
    createElement: tag => new Node(tag),
    createTextNode: text => new Text(text),
    activeElement: null,
    // js/help-button.js fills the page's «?» hosts the moment it is imported; this page has none.
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
}

export function walk(node, out = []) {
  out.push(node);
  node.children.forEach(child => walk(child, out));
  return out;
}

// Typing into a box, or choosing from a menu: set the value, then fire what a browser fires.
export function type(node, value) {
  node.value = value;
  node.fire('input');
  node.fire('change');
}
export function choose(select, value) {
  select.value = value;
  select.fire('change');
}
export function click(node) { node.fire('click'); }

// A node is shown when neither it nor an ancestor is hidden.
export function shown(node) {
  for (let n = node; n; n = n.parentNode) if (n.hidden) return false;
  return true;
}
