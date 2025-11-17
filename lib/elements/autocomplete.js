'use strict';

const color = require('kleur');
const Prompt = require('./prompt');
const { erase, cursor } = require('sisteransi');
const { style, clear, figures, wrap, entriesToDisplay } = require('../util');

const getVal = (arr, i) => arr[i] && (arr[i].value || arr[i].title || arr[i]);
const getTitle = (arr, i) => arr[i] && (arr[i].title || arr[i].value || arr[i]);
const getIndex = (arr, valOrTitle) => {
  const index = arr.findIndex(el => el.value === valOrTitle || el.title === valOrTitle);
  return index > -1 ? index : undefined;
};

class AutocompletePrompt extends Prompt {
  constructor(opts = {}) {
    super(opts);
    this.msg = opts.message;
    this.suggest = opts.suggest;
    this.choices = opts.choices.map((c, i) => ({
      title: c.title ?? c.value ?? c,
      value: c.value ?? c.title ?? c,
      description: c.description,
      disabled: c.disabled || false
    }));

    this.warn = opts.warn || '- This option is disabled';

    this.initial = typeof opts.initial === 'number'
      ? opts.initial
      : getIndex(opts.choices, opts.initial);

    this.select = this.initial || opts.cursor || 0;
    this.i18n = { noMatches: opts.noMatches || 'no matches found' };
    this.fallback = opts.fallback || this.initial;
    this.clearFirst = opts.clearFirst || false;

    this.suggestions = [];
    this.input = '';
    this.limit = opts.limit || 10;
    this.cursor = 0;

    this.transform = style.render(opts.style);
    this.scale = this.transform.scale;
    this.render = this.render.bind(this);
    this.complete = this.complete.bind(this);
    this.clear = clear('', this.out.columns);

    this.complete(this.render);
    this.render();
  }

  /* ---------- disabled-aware selection movement ---------- */
  moveSelect(i) {
    const len = this.suggestions.length;
    if (!len) return;

    let idx = i;

    // skip disabled items going forward
    if (idx >= 0 && idx < len && this.suggestions[idx].disabled) {
      const dir = idx > this.select ? 1 : -1;
      while (this.suggestions[idx] && this.suggestions[idx].disabled) {
        idx += dir;
        if (idx < 0 || idx >= len) return this.bell();
      }
    }

    this.select = idx;
    this.value = this.suggestions[idx]?.value ?? this.fallback.value;
    this.fire();
  }

  /* ---------- run suggestion algorithm and keep disabled flag ---------- */
  async complete(cb) {
    const p = (this.completing = this.suggest(this.input, this.choices));
    const suggestions = await p;

    if (this.completing !== p) return;

    this.suggestions = suggestions.map((s, i, arr) => ({
      title: getTitle(arr, i),
      value: getVal(arr, i),
      description: s.description,
      disabled: s.disabled || false
    }));

    this.completing = false;
    const l = Math.max(this.suggestions.length - 1, 0);
    this.moveSelect(Math.min(l, this.select));

    cb && cb();
  }

  /* ---------- prevent submit on disabled ---------- */
  submit() {
    const sel = this.suggestions[this.select];
    if (sel && sel.disabled) {
      this.bell();
      return;
    }

    this.done = true;
    this.aborted = this.exited = false;
    this.fire();
    this.render();
    this.out.write('\n');
    this.close();
  }

  /* ---------- navigation skips disabled via moveSelect() ---------- */
  up() {
    this.moveSelect(this.select === 0
      ? this.suggestions.length - 1
      : this.select - 1);
    this.render();
  }

  down() {
    this.moveSelect(this.select === this.suggestions.length - 1
      ? 0
      : this.select + 1);
    this.render();
  }

  next() { this.down(); }
  first() { this.moveSelect(0); this.render(); }
  last() { this.moveSelect(this.suggestions.length - 1); this.render(); }


  /* ---------- render disabled items similar to SelectPrompt ---------- */
  renderOption(v, hovered, isStart, isEnd) {
    let desc = '';
    let prefix = isStart ? figures.arrowUp : isEnd ? figures.arrowDown : ' ';

    if (v.disabled) {
      const title = hovered
        ? color.gray().underline(v.title)
        : color.strikethrough().gray(v.title);

      prefix = (hovered
        ? color.bold().gray(figures.pointer) + ' '
        : '  ') + prefix;

      return prefix + ' ' + title + color.gray(desc);
    }

    // normal (non-disabled)
    let title = hovered ? color.cyan().underline(v.title) : v.title;
    prefix = (hovered ? color.cyan(figures.pointer) + ' ' : '  ') + prefix;

    if (v.description) {
      desc = ` - ${v.description}`;
      if (prefix.length + title.length + desc.length >= this.out.columns
        || v.description.split(/\r?\n/).length > 1) {
        desc = '\n' + wrap(v.description, { margin: 3, width: this.out.columns });
      }
    }

    return prefix + ' ' + title + color.gray(desc);
  }


  /* ---------- main render ---------- */
  render() {
    if (this.closed) return;
    if (this.firstRender) this.out.write(cursor.hide);
    else this.out.write(clear(this.outputText, this.out.columns));

    super.render();

    let { startIndex, endIndex } = entriesToDisplay(this.select, this.choices.length, this.limit);

    const sel = this.suggestions[this.select];

    const hint = (sel && sel.disabled)
      ? color.yellow(this.warn)
      : this.rendered = this.transform.render(this.input);

    this.outputText = [
      style.symbol(this.done, this.aborted, this.exited),
      color.bold(this.msg),
      style.delimiter(this.completing),
      this.done && sel ? sel.title : hint
    ].join(' ');

    if (!this.done) {
      const suggestions =
        this.suggestions.slice(startIndex, endIndex)
          .map((item, i) =>
            this.renderOption(
              item,
              this.select === i + startIndex,
              i === 0 && startIndex > 0,
              i + startIndex === endIndex - 1 && endIndex < this.choices.length
            )
          ).join('\n');

      this.outputText += '\n' + (suggestions || color.gray(this.fallback.title));
    }

    this.out.write(erase.line + cursor.to(0) + this.outputText);
  }
}

module.exports = AutocompletePrompt;
