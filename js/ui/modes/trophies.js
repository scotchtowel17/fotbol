// '#/trophies': the trophy room (ARCHITECTURE §5.13). Visual first: icons, cards and swatches, short labels.
//
//   #/trophies               your player card and three big tiles (badges, stickers, kit)
//   #/trophies/badges        every badge: bright with the day you earned it, or greyed with a progress bar
//   #/trophies/album         the sticker album: a card per principle of the drill modules (M1-M3), framed
//                            bronze, silver or gold by mastery; a mystery card links to its drills
//   #/trophies/kit[/<id>]    the kit locker: shirt colours (unlocked by level), your number and a nickname;
//                            Save applies it app-wide (the boards, the header). <id> pre-selects a colour to try.
//
// Everything is read from the rewards state (js/ui/rewards-store.js); nothing here scores or awards.
// Pure helpers (albumModel, shortDay) are exported for tests/celebrate.test.js.

import { el, button, icon, announce, uid } from '../components.js';
import { badgeProgress, cardTier, kitOptions, setKit, cleanNickname, REWARDS_DEFAULTS, paletteById } from '../../rewards.js';
import { loadRewards, saveRewards, onRewards } from '../rewards-store.js';
import { playerCard, kitToken, TIER_ICONS } from '../celebrate.js';
import { pickText, principleLabel } from '../reveal.js';
import { drillModules } from '../session.js';
import { ROLE_INFO } from '../../engine/roles.js';

export const TROPHY_TABS = Object.freeze(['overview', 'badges', 'album', 'kit']);
const TAB_ICONS = Object.freeze({ overview: '🏆', badges: '🏅', album: '📒', kit: '👕' });

const COPY = {
  standard: {
    title: 'Trophy room',
    nav: 'Trophy room sections',
    tabs: { overview: 'All', badges: 'Badges', album: 'Stickers', kit: 'Kit' },
    badgesSr: (n, max) => `${n} of ${max} badges`,
    cardsSr: (n, max) => `${n} of ${max} stickers collected`,
    earnedSr: (day) => (day ? `Earned on ${day}.` : 'Earned.'),
    progressSr: (n, max) => `${n} of ${max} so far.`,
    notYet: 'Not yet',
    unlock: 'Practise to unlock',
    cardSr: (id, name, tier) => `${id}: ${name}. ${tier} sticker.`,
    mysterySr: (id, name) => `${id}: ${name}. Not collected yet. Practise to unlock.`,
    tiers: { 1: 'Bronze', 2: 'Silver', 3: 'Gold' },
    shirt: 'Shirt',
    number: 'Number',
    nickname: 'Nickname',
    nickHint: 'A nickname, not your real name. It stays on this device.',
    save: 'Save',
    saved: 'Saved',
    savedSr: 'Kit saved.',
    lockedAt: (n) => `Lv ${n}`,
    lockedSr: (name, n) => `${name}, unlocks at level ${n}`,
    kitTile: 'Kit',
  },
  kid: {
    title: 'Trophy room',
    nav: 'Trophy room sections',
    tabs: { overview: 'All', badges: 'Badges', album: 'Stickers', kit: 'Kit' },
    badgesSr: (n, max) => `${n} of ${max} badges`,
    cardsSr: (n, max) => `${n} of ${max} stickers`,
    earnedSr: (day) => (day ? `You got it on ${day}.` : 'You got it!'),
    progressSr: (n, max) => `${n} of ${max} so far.`,
    notYet: 'Not yet',
    unlock: 'Practise to unlock',
    cardSr: (id, name, tier) => `${id}: ${name}. ${tier} sticker.`,
    mysterySr: (id, name) => `${id}: ${name}. Not yours yet. Practise to unlock.`,
    tiers: { 1: 'Bronze', 2: 'Silver', 3: 'Gold' },
    shirt: 'Shirt',
    number: 'Number',
    nickname: 'Nickname',
    nickHint: 'Use a nickname, not your real name. It stays on this device.',
    save: 'Save',
    saved: 'Saved!',
    savedSr: 'Your kit is saved.',
    lockedAt: (n) => `Lv ${n}`,
    lockedSr: (name, n) => `${name}, unlocks at level ${n}`,
    kitTile: 'Kit',
  },
};

// ---------------------------------------------------------------- pure helpers

/** 'YYYY-MM-DD' → a short local date ("27 Sep"); '' for anything else. */
export function shortDay(day, locale) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  try { return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }); } catch { return day; }
}

/**
 * The sticker album: one card per principle of the drill modules (in curriculum order, each principle once),
 * with its tier (0 = not collected).
 * @returns {{ modules: { id, title, cards: { id, label, name, tier }[] }[], collected: number, total: number,
 *   tiers: { 1: number, 2: number, 3: number } }}
 */
export function albumModel(curriculum, principles, state, wording = 'standard') {
  const byId = principles?.byId ?? principles ?? {};
  const seen = new Set();
  const tiers = { 1: 0, 2: 0, 3: 0 };
  const modules = drillModules(curriculum).map((m) => ({
    id: m.id,
    title: m.title ?? m.id,
    cards: (m.principles ?? []).filter((id) => !seen.has(id) && seen.add(id)).map((id) => {
      const tier = cardTier(state, id);
      if (tier) tiers[tier]++;
      return { id, label: principleLabel(byId[id], wording) || id, name: byId[id]?.name ?? id, tier };
    }),
  })).filter((m) => m.cards.length);
  const cards = modules.flatMap((m) => m.cards);
  return { modules, collected: cards.filter((c) => c.tier > 0).length, total: cards.length, tiers };
}

// ---------------------------------------------------------------- the view

/** Mode contract (ARCHITECTURE §5.9). @returns {() => void} unmount */
export async function mount(root, app, params = []) {
  const tab = TROPHY_TABS.includes(String(params[0] ?? '').toLowerCase()) ? String(params[0]).toLowerCase() : 'overview';
  const wording = () => (app.settings.wording === 'kid' ? 'kid' : 'standard');
  const C = () => COPY[wording()];
  const principles = app.data.principles?.byId ?? {};
  const roleNum = () => ROLE_INFO[app.settings.role]?.num ?? null;

  // The kit being tried on (saved only with Save). A colour named in the link (the level-up's "Try it on") is
  // pre-selected when it is unlocked.
  const saved = loadRewards(app);
  const tryOn = String(params[1] ?? '');
  const draft = { ...saved.kit };
  if (tab === 'kit' && kitOptions(saved).some((p) => p.id === tryOn && p.unlocked)) draft.palette = tryOn;
  let justSaved = false;

  function render({ keepFocus = false } = {}) {
    const state = loadRewards(app);
    const focusedId = keepFocus ? document.activeElement?.id : null;
    const c = C();
    root.replaceChildren(el('div', { class: 'page tr' }, [
      el('h1', { class: 'tr-title' }, [el('span', { 'aria-hidden': 'true', text: '🏆 ' }), c.title]),
      playerCard(app, state, { trophies: false }),
      tabs(),
      el('div', { class: 'tr-body' }, [
        tab === 'badges' ? badgesView(state) : tab === 'album' ? albumView(state) : tab === 'kit' ? kitView(state) : overview(state),
      ]),
    ]));
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  }

  function tabs() {
    const c = C();
    return el('nav', { class: 'tr-tabs', 'aria-label': c.nav }, TROPHY_TABS.map((t) => el('a', {
      class: 'tr-tab', href: t === 'overview' ? '#/trophies' : `#/trophies/${t}`, 'aria-current': t === tab ? 'page' : null,
    }, [el('span', { class: 'tr-tab-icon', 'aria-hidden': 'true', text: TAB_ICONS[t] }), el('span', { text: c.tabs[t] })])));
  }

  // ---- overview: three big tiles
  function overview(state) {
    const c = C();
    const badges = badgeProgress(state);
    const earned = badges.filter((b) => b.earned).sort((a, b) => String(state.badges[b.id]?.day ?? '').localeCompare(String(state.badges[a.id]?.day ?? '')));
    const album = albumModel(app.data.curriculum, principles, state, wording());
    const kit = paletteById(state.kit.palette);
    const tile = (href, visual, count, label, sr) => el('a', { class: 'tr-tile', href }, [
      el('span', { class: 'tr-tile-visual', 'aria-hidden': 'true' }, visual),
      el('b', { class: 'tr-tile-count', 'aria-hidden': 'true', text: count }),
      el('span', { class: 'tr-tile-label' }, [label, sr ? el('span', { class: 'visually-hidden', text: `: ${sr}` }) : null]),
    ]);
    return el('div', { class: 'tr-tiles' }, [
      tile('#/trophies/badges',
        earned.length ? earned.slice(0, 3).map((b) => el('span', { class: 'tr-tile-emoji', text: b.icon })) : [el('span', { class: 'tr-tile-emoji is-dim', text: '🏅' })],
        `${earned.length}/${badges.length}`, c.tabs.badges, c.badgesSr(earned.length, badges.length)),
      tile('#/trophies/album',
        [1, 2, 3].map((t) => el('span', { class: ['tr-tile-medal', !album.tiers[t] && 'is-dim'] }, [el('span', { text: TIER_ICONS[t] }), el('small', { text: String(album.tiers[t]) })])),
        `${album.collected}/${album.total}`, c.tabs.album, c.cardsSr(album.collected, album.total)),
      tile('#/trophies/kit', [kitToken(kit, { number: state.kit.number ?? roleNum(), size: 56 })], kit.name, c.kitTile, null),
    ]);
  }

  // ---- badges: every badge, earned bright, locked greyed with its progress
  function badgesView(state) {
    const c = C();
    const w = wording();
    return el('ul', { class: 'tr-badges' }, badgeProgress(state).map((b) => {
      const day = state.badges[b.id]?.day ?? null;
      const when = b.earned ? shortDay(day) : '';
      return el('li', { class: ['tr-badge', b.earned ? 'is-earned' : 'is-locked'] }, [
        el('span', { class: 'tr-badge-icon', 'aria-hidden': 'true', text: b.icon }),
        el('b', { class: 'tr-badge-name', text: pickText(b.name, w) }),
        el('span', { class: 'tr-badge-desc', text: pickText(b.description, w) }),
        b.earned
          ? el('span', { class: 'tr-badge-when' }, [icon('check', { size: 14 }), el('span', { 'aria-hidden': 'true', text: when || '✓' }), el('span', { class: 'visually-hidden', text: c.earnedSr(when) })])
          : el('span', { class: 'tr-badge-progress' }, [
            el('span', { class: 'tr-bar', 'aria-hidden': 'true' }, [el('span', { style: { width: `${Math.round(b.progress * 100)}%` } })]),
            el('small', { 'aria-hidden': 'true', text: b.goal > 1 ? `${b.current}/${b.goal}` : c.notYet }),
            el('span', { class: 'visually-hidden', text: b.goal > 1 ? c.progressSr(b.current, b.goal) : `${c.notYet}.` }),
          ]),
      ]);
    }));
  }

  // ---- the sticker album
  function albumView(state) {
    const c = C();
    const album = albumModel(app.data.curriculum, principles, state, wording());
    return el('div', { class: 'tr-album' }, [
      el('p', { class: 'tr-count' }, [
        el('span', { 'aria-hidden': 'true', text: '📒' }), el('b', { 'aria-hidden': 'true', text: String(album.collected) }), el('span', { 'aria-hidden': 'true', text: ` / ${album.total}` }),
        el('span', { class: 'visually-hidden', text: c.cardsSr(album.collected, album.total) }),
      ]),
      ...album.modules.map((m) => el('section', { class: 'tr-album-module', 'aria-labelledby': `tr-m-${m.id}` }, [
        el('h2', { class: 'tr-h', id: `tr-m-${m.id}` }, [el('b', { text: m.id }), ` ${m.title}`]),
        el('ul', { class: 'tr-cards' }, m.cards.map((card) => el('li', {}, [card.tier
          ? el('a', { class: ['tr-card', `tier-${card.tier}`], href: `#/learn/p/${encodeURIComponent(card.id)}`, 'aria-label': c.cardSr(card.id, card.label, c.tiers[card.tier]) }, [
            el('span', { class: 'tr-card-medal', 'aria-hidden': 'true', text: TIER_ICONS[card.tier] }),
            el('span', { class: 'tr-card-id', 'aria-hidden': 'true', text: card.id }),
            el('span', { class: 'tr-card-name', 'aria-hidden': 'true', text: card.label }),
          ])
          : el('a', { class: 'tr-card is-mystery', href: `#/drill/p/${encodeURIComponent(card.id)}`, 'aria-label': c.mysterySr(card.id, card.label) }, [
            el('span', { class: 'tr-card-q', 'aria-hidden': 'true', text: '?' }),
            el('span', { class: 'tr-card-id', 'aria-hidden': 'true', text: card.id }),
            el('span', { class: 'tr-card-name', 'aria-hidden': 'true', text: c.unlock }),
          ])]))),
      ])),
    ]);
  }

  // ---- the kit locker
  function kitView(state) {
    const c = C();
    const palette = paletteById(draft.palette);
    const preview = el('div', { class: 'tr-kit-preview' });
    const drawPreview = () => {
      const nick = cleanNickname(draft.nickname);
      preview.replaceChildren(kitToken(paletteById(draft.palette), { number: draft.number ?? roleNum(), label: nick || 'YOU', size: 104 }));
      status.hidden = !justSaved;
    };
    const status = el('p', { class: 'tr-saved', role: 'status' }, [icon('check', { size: 16 }), c.saved]);
    const swatches = el('fieldset', { class: 'tr-swatches' }, [
      el('legend', { class: 'tr-legend', text: c.shirt }),
      el('div', { class: 'tr-swatch-grid' }, kitOptions(state).map((p) => el('label', { class: ['tr-swatch', !p.unlocked && 'is-locked'], title: p.unlocked ? p.name : c.lockedSr(p.name, p.level) }, [
        el('input', {
          type: 'radio', name: 'tr-kit', value: p.id, checked: p.id === palette.id, disabled: !p.unlocked,
          'aria-label': p.unlocked ? p.name : c.lockedSr(p.name, p.level),
          onchange: (e) => { if (e.target.checked) { draft.palette = p.id; justSaved = false; drawPreview(); } },
        }),
        el('span', { class: 'tr-swatch-box', 'aria-hidden': 'true' }, [
          kitToken(p, { size: 40 }),
          p.unlocked ? el('span', { class: 'tr-swatch-name', text: p.name }) : el('span', { class: 'tr-swatch-lock' }, [icon('lock', { size: 14 }), c.lockedAt(p.level)]),
        ]),
      ]))),
    ]);
    const numId = uid('tr-num'), nickId = uid('tr-nick'), hintId = uid('tr-hint');
    const num = el('input', {
      id: numId, class: 'tr-input tr-input--num', type: 'number', min: '1', max: '99', step: '1', inputmode: 'numeric',
      value: draft.number ?? '', placeholder: String(roleNum() ?? ''),
      oninput: (e) => {
        const n = Number.parseInt(e.target.value, 10);
        draft.number = Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
        justSaved = false;
        drawPreview();
      },
    });
    const nick = el('input', {
      id: nickId, class: 'tr-input', type: 'text', maxlength: String(REWARDS_DEFAULTS.nicknameMax), autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'words', value: draft.nickname ?? '', 'aria-describedby': hintId,
      oninput: (e) => { draft.nickname = e.target.value; justSaved = false; drawPreview(); },
    });
    const save = button(c.save, { variant: 'primary', icon: 'check', className: 'tr-save', id: 'tr-save', onClick: () => {
      const next = setKit(loadRewards(app), { palette: draft.palette, number: draft.number, nickname: cleanNickname(draft.nickname) });
      saveRewards(app, next); // applies the kit app-wide and updates the header
      Object.assign(draft, next.kit);
      justSaved = true;
      render({ keepFocus: true });
      announce(C().savedSr);
    } });
    drawPreview();
    return el('div', { class: 'tr-kit' }, [
      preview,
      el('div', { class: 'tr-kit-form' }, [
        swatches,
        el('div', { class: 'tr-fields' }, [
          el('div', { class: 'tr-field' }, [el('label', { for: numId, text: c.number }), num]),
          el('div', { class: 'tr-field tr-field--wide' }, [el('label', { for: nickId, text: c.nickname }), nick]),
        ]),
        el('p', { class: 'tr-hint', id: hintId, text: c.nickHint }),
        el('div', { class: 'tr-kit-actions' }, [save, status]),
      ]),
    ]);
  }

  render();
  const offSettings = app.onSettings?.((_s, patch) => { if ('wording' in (patch ?? {}) || 'role' in (patch ?? {})) render(); });
  const offRewards = onRewards(() => { if (tab !== 'kit') render(); }); // the kit tab redraws itself on Save
  return () => { offSettings?.(); offRewards(); };
}
