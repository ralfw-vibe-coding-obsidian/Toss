/*
 * Minimales DOM mit genau den Helfern, die Obsidian an HTMLElement haengt.
 * Bewusst klein: es soll die Logik pruefen, nicht einen Browser nachbauen.
 */
class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.classes = new Set();
    this.text = '';
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.handlers = {};
    this.value = '';
    this.disabled = false;
    this.scrollHeight = 20;
  }
  _add(el) { this.children.push(el); el.parent = this; return el; }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  createSpan(o = {}) { return this.createEl('span', o); }
  createEl(tag, o = {}) {
    const e = new El(tag);
    if (o.cls) o.cls.split(' ').forEach((c) => e.classes.add(c));
    if (o.text !== undefined) e.text = o.text;
    if (o.attr) Object.assign(e.attrs, o.attr);
    return this._add(e);
  }
  empty() { this.children = []; this.text = ''; }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  hasClass(c) { return this.classes.has(c); }
  toggleClass(c, on) {
    if (on === undefined) on = !this.classes.has(c);
    if (on) this.classes.add(c); else this.classes.delete(c);
  }
  setText(t) { this.text = t; this.children = []; }
  appendText(t) { this.text += t; }
  setAttr(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(el) { return this._add(el); }
  contains(el) { return el === this || this.children.some((c) => c.contains(el)); }
  get firstChild() { return this.children[0] || (this.text ? {} : null); }
  addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
  focus() { global.document.activeElement = this; }
  fire(name, evt = {}) {
    for (const fn of this.handlers[name] || []) {
      fn(Object.assign({ preventDefault() {}, stopPropagation() {}, target: this }, evt));
    }
  }
  querySelector(sel) {
    const m = sel.match(/\[data-path="(.*)"\]/);
    const walk = (el) => {
      for (const c of el.children) {
        if (m && c.dataset.path === m[1]) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  all(pred, out = []) {
    for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); }
    return out;
  }
  dump(depth = 0) {
    const cls = this.classes.size ? '.' + [...this.classes].join('.') : '';
    const icon = this.icon ? ` <${this.icon}>` : '';
    const txt = this.text ? ` "${this.text.slice(0, 50)}"` : '';
    let s = `${'  '.repeat(depth)}${this.tagName}${cls}${icon}${txt}\n`;
    for (const c of this.children) s += c.dump(depth + 1);
    return s;
  }
}
module.exports = { El };
