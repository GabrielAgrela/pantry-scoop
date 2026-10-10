import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../public/js/dom.js', import.meta.url), 'utf8')
  .replace("import { feel } from './blob-buddy.js';", 'const feel = () => {};')
  .replace("import { t, translateMessage } from './i18n.js';", 'const t = (text) => text, translateMessage = t;')
  .replaceAll('export ', '');

function noticePage() {
  const timers = new Map();
  let timerId = 0;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.childNodes = []; this.events = {}; this.attrs = {};
      this.hidden = false; this.open = false;
      const classes = new Set();
      this.classList = { contains: name => classes.has(name), add: name => classes.add(name),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name) };
    }
    get isConnected() { return this === document.body || !!this.parentElement?.isConnected; }
    append(...children) {
      for (const child of children) { if (child instanceof Element) { child.remove(); child.parentElement = this; } this.childNodes.push(child); }
    }
    prepend(child) { child.remove(); child.parentElement = this; this.childNodes.unshift(child); }
    after(child) {
      child.remove(); child.parentElement = this.parentElement;
      this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this) + 1, 0, child);
    }
    remove() {
      if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this);
      this.parentElement = null;
    }
    replaceChildren(...children) { this.childNodes.forEach(child => { if (child instanceof Element) child.parentElement = null; }); this.childNodes = []; this.append(...children); }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(name, callback) { this.events[name] = callback; }
    contains(child) { return this === child || this.childNodes.some(node => node instanceof Element && node.contains(child)); }
    closest(tag) { return this.tagName === tag ? this : this.parentElement?.closest(tag); }
    querySelector(selector) {
      const all = descendants(this);
      if (selector === '#toast') return all.find(el => el === toastElement);
      if (selector.startsWith('button')) return all.find(el => el.tagName === 'button' && el.attrs.class !== 'toast-dismiss');
      return null;
    }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const descendants = el => el.childNodes.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
  const header = new Element('header'), toastElement = new Element('div'), main = new Element('main');
  toastElement.hidden = true;
  const document = {
    body: new Element('body'), activeElement: null, createElement: tag => new Element(tag), addEventListener() {},
    getElementById: id => id === 'toast' ? descendants(document.body).find(el => el === toastElement) : main,
    querySelector: selector => selector === '.app-header' ? header : null,
    querySelectorAll: () => descendants(document.body).filter(el => el.tagName === 'dialog' && el.open && !el.classList.contains('is-closing')),
  };
  document.body.append(header, toastElement, main);
  const api = runInNewContext(`${source}\n({toast, showError, openDialog, h})`, {
    document, HTMLElement: Element, window: {},
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  return { ...api, document, header, el: toastElement, timers };
}

it('repeated notices do not restart the timer or replace their accessible content', () => {
  const page = noticePage();
  page.toast('Your pantry is updated');
  const content = page.el.childNodes, timer = [...page.timers.keys()][0];
  page.toast('Your pantry is updated');
  assert.equal(page.el.childNodes, content);
  assert.deepEqual([...page.timers.keys()], [timer]);
  page.timers.get(timer).callback();
  assert.equal(page.el.hidden, true);
  page.toast('Your pantry is updated');
  assert.equal(page.el.hidden, false, 'a later independent action can report the same result');
});

it('success cannot overwrite a visible error or its usage action', () => {
  const page = noticePage();
  page.showError({ message: 'Usage limit reached', code: 'usage-limit' });
  const content = page.el.childNodes;
  assert.equal(content[1].attrs.role, 'alert');
  assert.equal(content[1].childNodes[1].attrs.href, 'https://chatgpt.com/settings/usage');
  page.toast('Saved');
  assert.equal(page.el.childNodes, content);
  page.toast('Connection failed', { error: true });
  assert.notEqual(page.el.childNodes, content);
});

it('dismissal hides the notice and restores keyboard focus', () => {
  const page = noticePage();
  page.toast('Updated');
  const dismiss = page.el.childNodes.at(-1);
  dismiss.focus(); dismiss.events.click();
  assert.equal(page.el.hidden, true);
  assert.equal(page.document.activeElement, page.document.getElementById('main-content'));
  assert.equal(page.timers.size, 0);
});

it('modal errors stay in the active modal and the shared notice survives closing it', () => {
  const page = noticePage();
  const first = page.openDialog('edit', page.h('button', {}, 'Save'));
  const nested = page.openDialog('edit', page.h('button', {}, 'Retry'));
  page.toast('Could not save', { error: true });
  assert.equal(page.el.parentElement, nested.dialog);
  assert.equal(nested.dialog.childNodes[0], page.el);
  nested.close();
  assert.equal(page.el.hidden, true);
  assert.equal(page.el.parentElement, page.document.body);
  page.toast('Try again', { error: true });
  assert.equal(page.el.parentElement, first.dialog);
  first.close();
  page.toast('Updated');
  assert.equal(page.el.parentElement, page.document.body);
  assert.equal(page.document.body.childNodes[1], page.el, 'page notice sits between header and main');
});
