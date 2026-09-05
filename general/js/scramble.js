// scramble.js — cycles a phrase list into a .text element with a per-glyph
// scramble transition. Algorithm after Justin Windle's TextScramble
// (https://codepen.io/soulwire/pen/mErPAK), re-hand-written for this site.

class TextScramble {
  constructor(el) {
    this.el = el;
    this.chars = '01<>|/\\[]{}()=+-*?~_______';
    this.update = this.update.bind(this);
  }

  setText(newText) {
    const oldText = this.el.innerText;
    const length = Math.max(oldText.length, newText.length);
    const done = new Promise(resolve => (this.resolve = resolve));
    this.queue = [];
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || '';
      const to = newText[i] || '';
      const start = Math.floor(Math.random() * 40);
      const end = start + Math.floor(Math.random() * 40);
      this.queue.push({ from, to, start, end });
    }
    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return done;
  }

  update() {
    let output = '';
    let complete = 0;
    for (let i = 0, n = this.queue.length; i < n; i++) {
      let { from, to, start, end, char } = this.queue[i];
      if (this.frame >= end) {
        complete++;
        output += to;
      } else if (this.frame >= start) {
        if (!char || Math.random() < 0.28) {
          char = this.randomChar();
          this.queue[i].char = char;
        }
        output += `<span class="dud">${char}</span>`;
      } else {
        output += from;
      }
    }
    this.el.innerHTML = output;
    if (complete === this.queue.length) {
      this.resolve();
    } else {
      this.frameRequest = requestAnimationFrame(this.update);
      this.frame++;
    }
  }

  randomChar() {
    return this.chars[Math.floor(Math.random() * this.chars.length)];
  }
}

const phrases = [
  'experimental',
  'fabrication',
  'digital',
  'exploration',
  'electromechanical',
  'synergetics',
  'tactile',
  'prototyping'
];

const fx = new TextScramble(document.querySelector('.text'));
let i = 0;
(function cycle() {
  fx.setText(phrases[i]).then(() => setTimeout(cycle, 800));
  i = (i + 1) % phrases.length;
})();
