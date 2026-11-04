// Übernimmt die Sonderkarten-Symbole aus icons/*.svg in board.html und play.html (SPECIAL_SVG).
// Aufruf: node tools/embed-icons.mjs
// Eigene Symbole einfach in icons/dog.svg, icons/phoenix.svg, icons/dragon.svg ersetzen (viewBox 0 0 64 64,
// flache Farben: #8A5A16 dunkel, #b8862f mittel, Karte #e8c471) und das Skript laufen lassen.
import { readFileSync, writeFileSync } from 'node:fs';
const inner = (name) => {
  const svg = readFileSync(new URL(`../icons/${name}.svg`, import.meta.url), 'utf8').trim();
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`icons/${name}.svg ist kein gültiges SVG`);
  const markup = m[1].trim();
  if (/[`\\]|\$\{/.test(markup)) throw new Error(`icons/${name}.svg enthält ein unerlaubtes Zeichen (Backtick, Backslash oder \${)`);
  if (!/viewBox="0 0 64 64"/.test(svg)) throw new Error(`icons/${name}.svg: viewBox muss "0 0 64 64" sein`);
  return markup;
};
const block = '// <icons> (erzeugt von tools/embed-icons.mjs aus icons/*.svg - nicht von Hand ändern)\n'
  + 'const SPECIAL_SVG = {\n' + [['PHOENIX', 'phoenix'], ['DOG', 'dog'], ['DRAGON', 'dragon']].map(([k, f]) => `  ${k}: \`${inner(f)}\`,\n`).join('') + '};\n// </icons>\n';
for (const file of ['board.html', 'play.html']) {
  const url = new URL(`../${file}`, import.meta.url);
  let s = readFileSync(url, 'utf8');
  const re = /(\/\/ <icons>[\s\S]*?\/\/ <\/icons>\n)|(const SPECIAL_SVG = \{[\s\S]*?\n\};\n)/;
  if (!re.test(s)) throw new Error(`${file}: SPECIAL_SVG-Block nicht gefunden`);
  s = s.replace(re, () => block);
  writeFileSync(url, s);
  console.log(`${file}: Symbole übernommen`);
}
