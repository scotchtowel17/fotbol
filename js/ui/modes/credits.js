// '#/credits': credits, licences and privacy (RESEARCH 9.2 item 13, 6.5; THIRD_PARTY.md).
//
// Mirrors THIRD_PARTY.md: fotbol (MIT), the HELIOS Base formation data (MIT, with the attribution
// and the note on our edits), Delaunator (ISC) and robust-predicates (Unlicense), then the research
// the principles come from and a plain privacy note. Licence files are same-origin links; the
// sources are external links that open in a new tab. Nothing here is fetched.

import { el, icon, linkButton } from '../components.js';

export const REPO_URL = 'https://github.com/scotchtowel17/fotbol';
export const RESEARCH_URL = `${REPO_URL}/blob/main/docs/RESEARCH.md`;

/** Repo-relative file → URL next to index.html (this file is js/ui/modes/credits.js). */
const local = (path) => new URL(`../../../${path}`, import.meta.url).href;

const MIT_TEXT = (holder) => `MIT License

${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC_TEXT = `ISC License

Copyright (c) 2026, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

/** The code and data fotbol ships (THIRD_PARTY.md, RESEARCH 6.5). */
export const PACKAGES = Object.freeze([
  {
    id: 'fotbol',
    name: 'fotbol',
    licence: 'MIT',
    copyright: 'Copyright (c) 2026 Scott Whitworth and fotbol contributors',
    what: 'This app: the engine that judges your position, the drills and the explanations. Free to use, copy, change and share.',
    links: [{ label: 'Source code', href: REPO_URL }, { label: 'Licence', href: local('LICENSE'), local: true }],
  },
  {
    id: 'helios',
    wide: true,
    name: 'HELIOS Base formation data',
    licence: 'MIT',
    copyright: 'Copyright (c) 2021 HELIOS Base: A base team for the RoboCup Soccer Simulation',
    what: 'Where all 22 players stand for any ball position starts from the formation file of HELIOS Base, a team built for RoboCup robot football.',
    attribution: 'Formation samples derived from HELIOS Base (https://github.com/helios-base/helios-base), MIT License, Copyright (c) 2021 HELIOS Base. Converted to app coordinates and edited.',
    notes: [
      'We converted it to our pitch (x + 52.5, y + 34) and renamed the roles, from commit 538d9a72. It carries 48 documented edits: 26 pull the far-side full-back back to at most 4 m ahead of the near-side full-back, and 22 centre the #6 and #9 when the ball is central. Later coach edits are ours.',
      'We use only the formation data file, not HELIOS\'s C++ code (whose files carry GPL/LGPL headers). The blending between samples follows the Delaunay-triangulation method of Akiyama and Noda (2008).',
    ],
    links: [
      { label: 'helios-base on GitHub', href: 'https://github.com/helios-base/helios-base' },
      { label: 'Akiyama and Noda (2008)', href: 'https://link.springer.com/chapter/10.1007/978-3-540-68847-1_38' },
    ],
    text: MIT_TEXT('Copyright (c) 2021 HELIOS Base: A base team for the RoboCup Soccer Simulation'),
  },
  {
    id: 'delaunator',
    name: 'Delaunator 5.1.0',
    licence: 'ISC',
    copyright: 'Copyright (c) 2026, Mapbox',
    what: 'Joins the formation samples into triangles, so the team shape blends smoothly as the ball moves. Vendored unmodified, except that its import of robust-predicates points at our copy.',
    links: [{ label: 'mapbox/delaunator', href: 'https://github.com/mapbox/delaunator' }, { label: 'Licence', href: local('vendor/delaunator/LICENSE'), local: true }],
    text: ISC_TEXT,
  },
  {
    id: 'robust-predicates',
    name: 'robust-predicates 3.0.3',
    licence: 'Unlicense',
    copyright: 'Public domain',
    what: 'Exact geometry tests that Delaunator relies on. Vendored unmodified.',
    links: [{ label: 'mourner/robust-predicates', href: 'https://github.com/mourner/robust-predicates' }, { label: 'Licence', href: local('vendor/robust-predicates/LICENSE'), local: true }],
  },
]);

/** Key sources from RESEARCH section 10 (the report has the full list and what each was used for). */
export const SOURCES = Object.freeze([
  {
    group: 'Coaching curricula and laws',
    items: [
      { label: 'US Youth Soccer ODP Player Manual', href: 'https://www.usyouthsoccer.org/wp-content/uploads/sites/160/2023/09/Player-Manual-US-Youth-Soccer-ODP.pdf' },
      { label: 'U.S. Soccer Coaching Curriculum', href: 'https://cdn2.sportngin.com/attachments/document/0073/5091/Full_U.S._Soccer_Coaching_Curriculumnew.pdf' },
      { label: 'The FA England DNA: out of possession', href: 'https://www.thefa.com/bootroom/resources/england-dna/how-we-play/out-of-possession' },
      { label: 'IFAB Laws of the Game (Law 11, offside)', href: 'https://www.theifab.com/laws/latest/offside/' },
    ],
  },
  {
    group: 'Tactics writing',
    items: [
      { label: 'Spielverlagerung', href: 'https://spielverlagerung.com/' },
      { label: "Coaches' Voice: tactics glossary", href: 'https://learning.coachesvoice.com/cv/glossary-football-tactics-coaching/' },
      { label: 'Touchline Theory: positional play', href: 'https://touchlinetheory.com/the-practical-guide-to-actually-understanding-positional-play/' },
    ],
  },
  {
    group: 'Positioning models',
    items: [
      { label: 'Akiyama and Noda (2008): Delaunay-triangulation positioning', href: 'https://link.springer.com/chapter/10.1007/978-3-540-68847-1_38' },
      { label: 'Spearman et al. (2017): pass probabilities and pitch control', href: 'https://static.hudl.com/craft/downloads/SSAC17-Physics-Based-Modeling-of-Pass-Probabilities-in-Soccer.pdf?mtime=20180305082035' },
      { label: 'Fernandez and Bornn (2018): space occupation', href: 'https://www.lukebornn.com/papers/fernandez_ssac_2018.pdf' },
    ],
  },
  {
    group: 'Learning science and tactical testing',
    items: [
      { label: 'Pelánek (2016): Elo ratings for adaptive practice', href: 'http://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf' },
      { label: 'Papoušek et al. (2016): choosing question difficulty', href: 'http://www.fi.muni.cz/~xpelanek/publications/its-target-difficulty.pdf' },
      { label: 'FUT-SAT: tactical assessment in football', href: 'https://revistas.rcaap.pt/motricidade/article/view/121' },
      { label: 'TacticUP: video-based tactical decisions', href: 'https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.01690/full' },
    ],
  },
]);

const COPY = {
  standard: {
    kicker: 'Credits and licences',
    title: 'Built on open work',
    lead: 'fotbol is free and open source. It stands on formation data from robot football, two small geometry libraries and a lot of coaching research. Here is who to thank, and the licences that let us use their work.',
    privacyTitle: 'Your privacy',
    privacy: [
      ['No accounts', 'You never sign up or log in, and fotbol never asks who you are.'],
      ['No tracking', 'No analytics, no ads, no cookies. Nothing is counted or reported.'],
      ['Nothing leaves your device', 'Every file comes from this site, and fotbol makes no requests to anyone else.'],
      ['Your progress stays here', 'Stars, history and settings are saved in this browser only. You can export them to a file, or import them on another device, from the Progress page. Clearing this site\'s data in your browser deletes them.'],
    ],
    savingOn: 'This browser is saving your progress.',
    savingOff: 'This browser window cannot save (private browsing or blocked storage), so your progress lasts until you close it.',
    codeTitle: 'Code and data',
    researchTitle: 'The football ideas',
    research: 'Every principle, rule and explanation in fotbol is our own paraphrase of coaching curricula, tactics writing and research. No coaching text is copied. The research report lists every source and what we took from it.',
    researchLink: 'Read the research report',
    foot: 'Spotted a missing credit or a mistake?',
    issue: 'Tell us on GitHub',
  },
  kid: {
    kicker: 'Thank you',
    title: 'Who helped build fotbol',
    lead: 'fotbol is free. These are the people and projects that helped make it.',
    privacyTitle: 'Your privacy',
    privacy: [
      ['No sign-up', 'You never make an account. We don\'t know who you are.'],
      ['No tracking', 'No ads and nothing that watches what you do.'],
      ['Your stars stay here', 'Your progress is saved on this device only. A grown-up can move it to another device from the Progress page.'],
    ],
    savingOn: 'This device is saving your stars.',
    savingOff: 'This window can\'t save your stars, so they go away when you close it.',
    codeTitle: 'Code and data',
    researchTitle: 'Where the football ideas come from',
    research: 'The tips in fotbol come from coaches and football experts. We wrote them in our own words.',
    researchLink: 'Read where they come from',
    foot: 'Found a mistake?',
    issue: 'Tell us on GitHub',
  },
};

/** External link: opens in a new tab, says so to screen readers. */
function ext(label, href, attrs = {}) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, [label, el('span', { class: 'visually-hidden', text: ' (opens in a new tab)' })]);
}

function packageCard(p) {
  return el('article', { class: ['cr-card', p.wide && 'cr-card--wide'], 'aria-labelledby': `cr-${p.id}` }, [
    el('div', { class: 'cr-card-head' }, [
      el('h3', { id: `cr-${p.id}`, text: p.name }),
      el('span', { class: 'cr-licence', text: p.licence }),
    ]),
    el('p', { class: 'cr-what', text: p.what }),
    el('p', { class: 'cr-copy', text: p.copyright }),
    p.attribution ? el('blockquote', { class: 'cr-attribution' }, [el('p', { text: p.attribution })]) : null,
    p.notes?.length ? el('div', { class: 'cr-notes' }, p.notes.map((n) => el('p', { class: 'cr-note', text: n }))) : null,
    el('ul', { class: 'cr-links' }, p.links.map((l) => el('li', {}, [l.local ? el('a', { href: l.href, text: l.label }) : ext(l.label, l.href)]))),
    p.text ? el('details', { class: 'cr-text' }, [el('summary', { text: `${p.licence} licence text` }), el('pre', { text: p.text })]) : null,
  ]);
}

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app) {
  function render() {
    const w = app.settings.wording === 'kid' ? 'kid' : 'standard';
    const C = COPY[w];
    let persistent = true;
    try { persistent = app.store?.isPersistent?.() ?? true; } catch { persistent = false; }
    root.replaceChildren(el('div', { class: 'page credits' }, [
      el('header', { class: 'cr-hero' }, [
        el('p', { class: 'cr-kicker', text: C.kicker }),
        el('h1', { text: C.title }),
        el('p', { class: 'cr-lead', text: C.lead }),
      ]),

      el('section', { class: 'cr-privacy', 'aria-labelledby': 'cr-privacy-title' }, [
        el('h2', { id: 'cr-privacy-title', text: C.privacyTitle }),
        el('ul', { class: 'cr-promises' }, C.privacy.map(([title, text]) => el('li', {}, [
          el('span', { class: 'cr-tick', 'aria-hidden': 'true' }, [icon('check', { size: 18 })]),
          el('div', {}, [el('strong', { text: title }), el('p', { text })]),
        ]))),
        el('p', { class: ['cr-saving', !persistent && 'is-off'], role: 'status', text: persistent ? C.savingOn : C.savingOff }),
      ]),

      el('section', { class: 'cr-section', 'aria-labelledby': 'cr-code-title' }, [
        el('h2', { id: 'cr-code-title', text: C.codeTitle }),
        el('div', { class: 'cr-grid' }, PACKAGES.map(packageCard)),
      ]),

      el('section', { class: 'cr-section', 'aria-labelledby': 'cr-research-title' }, [
        el('h2', { id: 'cr-research-title', text: C.researchTitle }),
        el('p', { class: 'cr-research-lead', text: C.research }),
        el('div', { class: 'cr-sources' }, SOURCES.map((g) => el('div', { class: 'cr-source-group' }, [
          el('h3', { text: g.group }),
          el('ul', {}, g.items.map((s) => el('li', {}, [ext(s.label, s.href)]))),
        ]))),
        el('p', { class: 'cr-cta' }, [
          el('a', { class: 'btn btn--primary', href: RESEARCH_URL, target: '_blank', rel: 'noopener noreferrer' }, [
            icon('learn'), el('span', { text: C.researchLink }), el('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
          ]),
        ]),
      ]),

      el('footer', { class: 'cr-foot' }, [
        el('p', {}, [`${C.foot} `, ext(C.issue, `${REPO_URL}/issues`), '.']),
        linkButton('Back to home', '#/home', { variant: 'ghost', icon: 'arrow' }),
      ]),
    ]));
  }

  render();
  let lastWording = app.settings.wording;
  const off = app.onSettings?.((s) => {
    if (s.wording !== lastWording) { lastWording = s.wording; render(); }
  });
  return () => off?.();
}
