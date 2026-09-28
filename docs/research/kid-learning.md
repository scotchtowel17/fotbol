# Kid-first learning design: evidence and rules for fotbol (ages 10-14)

**Date:** 2026-09-27.

**Question.** What makes a learning app that 10-14-year-olds understand straight away and want to come back to? This file turns the evidence into testable design rules for fotbol.

**How it relates to the other docs.**
- It adds to [RESEARCH.md §7](../RESEARCH.md#7-learning-design-principles-pedagogy) and does not repeat it. §7 already covers:
  - place, don't pick;
  - freeze and replay;
  - guided discovery;
  - worked examples, then faded steps;
  - interleaving;
  - Elo targeting about 75% success;
  - spaced retrieval;
  - confidence ratings;
  - "gamify for mastery".
- The companion [kid-apps-teardown.md](kid-apps-teardown.md) covers app patterns and a proposed flow.

**Confidence tags.**
- **[strong]:** a meta-analysis, replicated experiments or a binding standard.
- **[moderate]:** one good study in or near this age band, usability research, or a number derived from normative data.
- **[weak]:** extrapolated from other ages, a company claim, or design judgement.

Most multimedia-learning experiments tested students older than 14, and the tags allow for that.

**Verification.** Every source was opened unless its entry in the source list says otherwise:
- `[abstract]`: only the abstract was read.
- `[secondary]`: the finding comes from another source's report.
- `[unverified]`: not confirmed at the source.

**Legal.** Nothing here is legal advice. Whether the UK Children's Code applies to an app that keeps data only on the device was not analysed; its standards are used here as good practice.

## Summary

- **Reading is the bottleneck.**
  - A typical US 5th grader reads aloud about 133 words a minute in winter, and the slowest tenth read about 84.
  - fotbol's reveal panel carries about 100-150 words. That is roughly 45-110 s of reading inside a rep designed to last 20-30 s. (The 100 is counted from the README screenshot; the 150 is the teardown's measurement of the live site.)
  - The fix:
    - write for a reading age of 9;
    - show no more than 30 words before a "Why?" tap;
    - move the explanation onto the pitch (spatial contiguity d = 0.82, coherence d = 0.86).
- **Show first, then tell.**
  - At this age, learners do best with a correct worked example, preferably animated, followed by guided tries:
    - worked examples: g = 0.48;
    - guided discovery: d = +0.30, against −0.38 for unguided discovery;
    - animation for motor-procedural skills: d = 1.06.
  - Tutorials and help buttons add little when the core action can be learned by doing, so the first drag should come within seconds of opening the app.
- **Feedback should be about the move, and it should not look like a school grade.**
  - In computer-based learning, explanations beat right/wrong feedback (0.49 vs 0.05).
  - Comments beat grades for 11-year-olds.
  - Praising intelligence and inflated praise ("You're incredible!") both backfire.
  - So replace the S-F letter with a distance and a three-level word, give one fix sentence, and put the principle behind "Why?".
- **Motivation at this age rests on autonomy, competence and respect, not on points.**
  - Autonomy means 2-4 real choices and making the player their own. Competence means visible mastery. Respect means no "kid" and nothing babyish.
  - Rewards tied to taking part, finishing or scoring reduce intrinsic motivation (d = −0.28 to −0.40), and tangible rewards do more harm to children than to adults. The ICO says 10-12-year-olds are especially susceptible to reward-based systems.
  - Keep rewards informational, earned and mostly unexpected. Celebrate milestones, not taps.
- **Ethics and accessibility are design work too.**
  - Avoid:
    - loss-framed streaks;
    - chance-based rewards;
    - guilt-trip copy;
    - automatic "play again";
    - comparisons with other players.
  - Keep all data on the device and say so in plain words.
  - Never use colour alone: about 1 in 12 boys is colour-blind. Keep text at 16 px or more, honour reduced motion, and offer a wider-spacing option.

## Design rules

Each rule is written to be checked: a word count, a pixel size, a feature that is present or absent, or a time.

### A. Words and reading
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 1 | Write all learner copy for a reading age of 9 (Flesch-Kincaid grade 4 or lower), with everyday words and one idea per sentence. Check it in CI next to the existing copy rules in `tests/scenarios-content.test.js`. | The UK Home Office design manual recommends a maximum reading age of 9, even for specialist audiences ([Home Office](https://design.homeoffice.gov.uk/accessibility/written-content/readability)). In the middle of the school year, a quarter of US 5th graders read below 620L, against a median of 820L ([Lexile norms](https://hub.lexile.com/lexile-grade-level-charts/)). Teens do worse than adults partly because they read less well, and NN/g advises a 6th-grade level or lower ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). | moderate |
| 2 | Word budget: the brief 12 words or fewer, the cue question 12 or fewer, and the whole reveal 30 or fewer until the player taps "Why?". | Grade 5 winter norms for oral reading: median 133 words a minute, 25th percentile 109, 10th percentile 84 ([Hasbrouck & Tindal 2017](https://files.eric.ed.gov/fulltext/ED594994.pdf)). So 30 words take 14-21 s, and today's 100-150-word reveal is longer than the whole rep in RESEARCH §7.2. Shute: give elaborated feedback in small, manageable units ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf)). | moderate |
| 3 | Name each principle in 2-4 plain football words. Never show principle codes (U2, D4), and never use terms like "half-space" without a picture. | The dyslexia style guide says to avoid jargon and abbreviations ([BDA 2023](https://www.bumc.bu.edu/jmedday/files/2025/05/Dyslexia-Style-Guide-2023-BDA-Style-Guide-2023.pdf)). Children take instructions literally and need a clear goal ([NN/g cognition](https://www.nngroup.com/articles/kids-cognition/)). Pre-training novices on the names of key parts works: 10 of 10 tests, d = 0.78 ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). | moderate |
| 4 | Talk to the player as "you" and name concrete moves ("Step 7 m toward your centre-back"), not abstract nouns ("keep compactness"). | Personalization: conversational wording won 13 of 15 tests, d = 1.00, though less so in long lessons or for experts ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). Children aged 7-11 reason best with concrete, specific instructions ([NN/g cognition](https://www.nngroup.com/articles/kids-cognition/)). | strong |
| 5 | Remove the word "kid" from the UI. The wording toggle in `js/main.js` is labelled "Kid": make simple wording the default for everyone and make "More detail" the opt-in. | "The word 'kid' is a teen repellent", and teens reject content that feels childish ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). Children also reject design aimed at a younger age band ([NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/)). | moderate |
| 6 | Type rules:<ul><li>body text 16 px or more, and the fix sentence 18 px or more;</li><li>line height 1.5, left-aligned, 70 characters or fewer a line, sentence case;</li><li>no italics, underlines or letter-spaced ALL-CAPS labels; use bold for emphasis.</li></ul> | BDA: 16-19 px, 1.5 line spacing, 60-70 characters a line, and no italics, underlining or capitals ([BDA 2023](https://www.bumc.bu.edu/jmedday/files/2025/05/Dyslexia-Style-Guide-2023-BDA-Style-Guide-2023.pdf)). Italic and serif fonts slowed readers with dyslexia ([Rello & Baeza-Yates 2013](https://dyslexiahelp.umich.edu/wp-content/uploads/2014/02/good_fonts_for_dyslexia_study.pdf)). NN/g recommends 12 pt for older children, and teens dislike tiny text ([NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/), [NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). | moderate |

### B. Screens, layout and input
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 7 | One job per screen. During Watch and Decide, show only the pitch, your token and at most one line of text. XP, stickers, navigation and the score stay hidden until the reveal. | Coherence: cutting extras helped in 18 of 19 tests, d = 0.86, most for learners with low working memory and when the app, not the learner, sets the pace ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). Children's working memory is smaller and keeps growing into adolescence ([NN/g cognition](https://www.nngroup.com/articles/kids-cognition/), [Gathercole 2004](https://doi.org/10.1037/0012-1649.40.2.177)). RITEC lists limiting distractions and pop-ups ([UNICEF 2022](https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf)). | strong |
| 8 | Put the words on the pitch: label the gap inside the gap, draw an arrow from you to the best spot, and highlight no more than 2 cues at a time. | Spatial contiguity: 9 of 9 tests, d = 0.82. Signaling: 26 of 28 tests, d = 0.70 (visual cues 11 of 12, d = 0.71), and best for novices when used sparingly ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). Shute: don't rely on text alone for feedback ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf)). | strong |
| 9 | The home screen has one big "Play" button and 3 other destinations or fewer. First-time players see no mode menu. Anything tappable looks tappable, and decoration does not. | NN/g rated redundant navigation very confusing for children but only slightly confusing for adults. Children "mine-sweep" the screen and expect pictures to respond ([NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/)). The limit of 3 is a design target. | moderate |
| 10 | Every tap target is at least 44 × 44 CSS px. That includes the player token's hit area, even if the token is drawn smaller. Nothing interactive is under 24 px. | WCAG 2.2 sets 44 px (AAA) and 24 px (AA) ([2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). Children miss touch targets more often than adults, and the youngest miss most ([MTAGIC](https://init.cise.ufl.edu/projects-gallery/mobile-touch-and-gesture-interaction-for-children-mtagic-2/), [Chen 2020](https://init.cise.ufl.edu/wp-content/uploads/sites/378/2017/03/chen-et-al-ICMI2020.pdf)). | strong |
| 11 | Keep "tap yourself, then tap the spot" as a full alternative to dragging, and show it in rep 1. | WCAG 2.5.7 (AA) requires a single-pointer alternative to any drag ([2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)). Dragging something precisely to a spot is hard for children, although by about 11 they can use the adult range of gestures ([NN/g physical](https://www.nngroup.com/articles/children-ux-physical-development/)). | strong |
| 12 | Phone first:<ul><li>design at 360-390 px wide;</li><li>the text sheet never covers the part of the pitch the decision needs;</li><li>the first rep is playable within 3 s on a mid-range phone.</li></ul> | At 10-12, children are much more likely to have their own device, mostly a smartphone ([ICO Annex B](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/)). Teens hate waiting for pages to load ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). The 3 s is a design target. | moderate |

### C. First session and onboarding
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 13 | On first open, the player taps one of 3 big shirts (defender, midfielder or attacker) and goes straight into a guided rep. The first drag happens 15 s or less after the app loads. No sign-up, settings or tour comes first. | In a study of over 45,000 players, tutorials did not help games whose rules can be learned by trying, and players learned more by experimenting than by reading ([Andersen 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)). Duolingo says it got about 20% more daily users by moving sign-up to after the first lesson ([First Round](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker/)). The 15 s is a design target. | moderate |
| 14 | Teach in context: show one tip of 10 words or fewer the first time something appears. No up-front tour, and no general Help button inside a rep. The 7-step Learn tour becomes optional. | Instructions given when needed raised play time 16% and progress 40%, but only in the most complex game. A help button cut progress 12% and play time 15% in a simpler puzzle game ([Andersen 2012](https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf)). | moderate |
| 15 | Rep 1 of each new principle is a correct worked example: the ghost moves to the best spot, then the player copies it. The free-play Explore mode unlocks after Module 1. | Worked examples: g = 0.48. Correct examples beat incorrect or mixed ones, and adding self-explanation prompts reduced the effect ([Barbieri 2023](https://eric.ed.gov/?id=EJ1364058)). Unguided discovery was worse than explicit teaching (d = −0.38), while guided discovery was better (d = 0.30) ([Alfieri 2011](https://eric.ed.gov/?id=EJ933606)). Animation helped most for motor-procedural skills (d = 1.06) ([Höffler & Leutner 2007](https://eric.ed.gov/?id=EJ780451)). This adds to RESEARCH §7.1 row 7. | strong |
| 16 | Offer "Watch again" before placing, and move through the reveal steps by tap, never on a timer. | Segmenting into steps the learner controls: 7 of 7 tests, d = 0.67, strongest for complex, fast material ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). | moderate |

### D. Feedback and results
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 17 | The reveal comes right after lock-in, in this order:<ol><li>the picture: your spot, the best spot and an arrow between them;</li><li>one fix sentence of 14 words or fewer;</li><li>the principle and the details, only behind "Why?".</li></ol>No hint interrupts the player while placing. | In computer-based learning, feedback that explains beat feedback that gives the answer, which beat right/wrong alone (0.49 vs 0.32 vs 0.05) ([Van der Kleij 2015](https://eric.ed.gov/?id=EJ1081708)). Shute: keep feedback simple, give it immediately for new or hard tasks, and don't interrupt a learner who is working ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf)). | strong |
| 18 | Replace the S-F letter and the "/100" score with a result about the task: a distance ("7 m from the best spot") plus one of three words (Spot on, Close, Not yet). Never show "F". | For 132 5th and 6th graders, interest and performance were highest after comments with no grade ([Butler 1988](https://eric.ed.gov/?id=EJ380489)). The benefit was mostly for low achievers ([Guskey 2019](https://www.edweek.org/education/opinion-grades-versus-comments-what-does-the-research-really-tell-us/2019/06)). Shute: be careful with overall grades ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf)). | moderate |
| 19 | Praise the move, never the person, and never exaggerate. Say "Good cover angle", not "You're a genius!", and keep "perfect" for the best spot. | 5th graders praised for being clever persisted less, enjoyed tasks less and did worse after a failure ([Mueller & Dweck 1998](https://doi.org/10.1037/0022-3514.75.1.33)). Inflated praise made children with low self-esteem avoid challenges ([Brummelman 2014](https://doi.org/10.1177/0956797613514251)). Shute: praise pulls attention onto the self and away from the task, so use it sparingly if at all ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf); see also [Hattie & Timperley 2007](https://eric.ed.gov/?id=EJ782448)). | strong |
| 20 | After a miss, frame it once as high standards plus belief ("Hard one. Pros miss it too. Try the mirror."), then give a similar rep. Don't use generic growth-mindset slogans. | "Wise" feedback of this kind made 7th graders revise their work more often and better ([Yeager 2014](https://doi.org/10.1037/a0033906)). Adolescents respond to respect and status ([Yeager 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5758430/)). Mindset interventions have weak average effects ([Sisk 2018](https://doi.org/10.1177/0956797617739704)). | moderate |
| 21 | Never compare the player with anyone else: no leaderboards, no percentiles, no "better than 80% of players". Compare only with their own past. | Shute: give no comparisons with others ([Shute 2008](https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf)). Adolescents are especially sensitive to being judged ([Somerville 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3992953/)). At 10-12, comparison with others hurts self-esteem ([ICO Annex B](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/)). Competitive single-player learning games: g = −0.06, against 0.45 for non-competitive ones ([Clark 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/)). | strong |

### E. Sessions and learning flow
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 22 | A session is 6 reps (about 3-4 min) and ends on a clear finish screen. "Play again" is a neutral choice, never automatic. After about 15 min, suggest a break. | ICO standard 5: offer to continue without suggesting children will lose out, and don't extend use automatically ([ICO std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)). ICO standard 13: nudge under-13s toward breaks ([ICO std 13](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/)). Learning games worked over several sessions but not in one (g = 0.44 vs 0.08) ([Clark 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/)). | moderate |
| 23 | Start every session with 1-2 quick recall reps from earlier principles, with no help, before any new material. | Recall practice gave clear gains to 88 children with a mean age of 10, whatever their reading level ([Karpicke 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4786565/)). Across 50 classroom experiments, 57% of the 49 effect sizes were medium or large ([Agarwal 2021](https://eric.ed.gov/?id=EJ1319572)). This covers RESEARCH §7.1 row 11 until ts-fsrs is built. | strong |
| 24 | The drill is the game: no unrelated mini-games, and at most a thin story around it ("your season"). Keep the pitch schematic, top-down and clean. | Learning effects by story depth: thin 0.47, none 0.44, medium −0.03. By visual style: schematic 0.48, realistic −0.01 ([Clark 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/)). Learning games were not more motivating than ordinary teaching (d = 0.26, not significant) ([Wouters 2013](https://eric.ed.gov/?id=EJ1008015)). | moderate |
| 25 | Progress shows what the player can do for each principle ("Cover: 3 of 3 this week"). The next principle unlocks by mastery, not by XP. | Mastery-learning programmes raised exam performance across 108 evaluations ([Kulik 1990](https://eric.ed.gov/?id=EJ415887)). Feeling competent predicts how much people enjoy a game and whether they play again ([Ryan 2006](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf)). RITEC: design activities children can improve and excel at ([UNICEF 2022](https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf)). | moderate |

### F. Motivation, rewards and identity
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 26 | Offer 2-4 real choices per session, for example position, challenge and kit. Don't pile on more. | Choice raised intrinsic motivation, effort and performance. The effect on motivation was largest when 2-4 choices were made in a row, and larger for children than adults ([Patall 2008](https://doi.org/10.1037/0033-2909.134.2.270)). Choice, personalisation and context raised motivation and engagement in 4th and 5th graders ([Cordova & Lepper 1996](https://eric.ed.gov/?id=EJ540338)). | strong |
| 27 | Let players make the player their own: kit colours, shirt number, boots, and a nickname picked from a list rather than typed. All of it is saved only on the device. Today the nickname is free text (`cleanNickname` in `js/rewards.js`). | Choices that didn't affect the task motivated most ([Patall 2008](https://doi.org/10.1037/0033-2909.134.2.270)). RITEC: let children change their characters ([UNICEF 2022](https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf)). At 10-12, children use online spaces to explore who they are ([ICO Annex B](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/)). A name is personal information under COPPA (FAQ A.3), so a pick-list avoids collecting one ([FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)). | moderate |
| 28 | Rewards carry information and are mostly unexpected. A sticker names the skill ("3 perfect covers"). No XP for opening the app, finishing a session or time spent. Today `js/rewards.js` gives XP for every attempt (`xpByGrade`), for finishing a session (`sessionXp`) and for the tutorial (`tutorialXp`): tie XP to improvement and mastery instead. | Across 128 studies, rewards for taking part, finishing or scoring cut free-choice motivation (d = −0.40, −0.36 and −0.28). Tangible rewards hurt children more. Positive, informational feedback helped (+0.33) ([Deci 1999](https://doi.org/10.1037/0033-2909.125.6.627)). The ICO says 10-12-year-olds are especially susceptible to reward-based systems ([ICO Annex B](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/)). | strong |
| 29 | Save big celebrations (confetti, fanfare) for real milestones, at most once a session. A good rep gets a short acknowledgement of under 0.6 s. | In one action game, both no effects and extreme effects cut play time and intrinsic motivation compared with medium or high effects ([Kao 2020](https://doi.org/10.1016/j.entcom.2020.100359)). Teens want less heavy animation and nothing childish ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/)). | moderate |
| 30 | Look like football, not a nursery: broadcast-style graphics, real positions and football words, and capable players. No baby talk, rhymes, cartoon animals or "!!!". | NN/g on rejecting childish or younger-looking design ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/), [NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/)). Adolescents want respect and status ([Yeager 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5758430/)). RITEC: strong, capable characters ([UNICEF 2022](https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf)). The style list itself is judgement. | moderate |
| 31 | Build connection without social risk: a "try it at training" challenge, a two-player pass-the-phone mode and a result card to share that uploads nothing. No chat, friend lists or public profiles. | RITEC lists parent-child co-play and connection ([UNICEF 2022](https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf)). Players learned more from games played in groups ([Wouters 2013](https://eric.ed.gov/?id=EJ1008015)). The FTC's case against Epic cited chat that was on by default and exposed children to strangers ([FTC Epic](https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations)). | weak |

### G. Sound, characters and voice
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 32 | Use short sounds for events only (lock-in, reveal, milestone). No music during Watch and Decide. One mute setting that persists. Nothing is conveyed by sound alone. | Background music and sound effects lowered recall and transfer in college students ([Moreno & Mayer 2000](https://eric.ed.gov/?id=EJ619361)). Cutting extras helps most when working memory is low ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). Children like sound ([NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/)). | moderate |
| 33 | No mascot as the teacher. Any guide is an optional "coach" whose words appear as text next to the pitch and who never pleads, sulks or guilt-trips. | A static on-screen character barely helped: d = 0.19, with 3 of 7 tests negative ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). On-screen tutors have small effects, larger in schools, and work better with text than narration ([Schroeder 2013](https://eric.ed.gov/?id=EJ1076333)). Moderately human-like game characters: g = 0.04 ([Clark 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/)). The FTC lists pressure from characters children trust as a dark pattern ([FTC 2022](https://www.ftc.gov/reports/bringing-dark-patterns-light)). A quarter of young children's apps that have characters use it ([Radesky 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206186/)). | moderate |
| 34 | Offer an optional "Read it to me" button that speaks the brief and the fix using the browser's speech. It is off by default and takes one tap. | Text-to-speech for students with reading difficulties: g = 0.35 ([Wood 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5494021/)). Spoken words beat printed ones (d = 1.00), but print is fine when learners set the pace ([Mayer 2023](https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf)). | moderate |

### H. Ethics, privacy and safety
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 35 | No streaks that can be lost. Show "days played this week", resetting weekly; never show a broken streak; no streak freezes. `js/rewards.js` already counts training days cumulatively, but the day streak in `js/ui/session.js` still resets to 1 after a gap. | Across 7 studies, showing people a broken streak reduced how much they did afterwards, more so when they blamed themselves ([Silverman & Barasch 2022](https://doi.org/10.1093/jcr/ucac029)). ICO standard 5: never suggest children will lose out ([ICO std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)). Fear of missing out is a factor at 10-12 ([ICO Annex B](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/)). | moderate |
| 36 | No rewards by chance: no packs, spins, mystery boxes or random rarity. Every reward says what earned it. Today's mastery stickers already comply. | Spending on loot boxes was linked to the severity of problem gambling in 7,422 gamers ([Zendle & Cairns 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6248934/)). The ICO lists reward loops among "sticky" features ([ICO std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)). | moderate |
| 37 | No pressure copy or tactics: no "Don't go!", no "Your team needs you", no countdown offers, no nagging notifications. The player can pause or quit at any time without losing progress. | ICO standard 5 asks for pause without lost progress ([ICO std 5](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/)). The FTC catalogues these patterns, including in children's apps ([FTC 2022](https://www.ftc.gov/reports/bringing-dark-patterns-light)). Among apps used by children aged 3-5, 46% blocked navigation, 45% used lures and 17% used time pressure ([Radesky 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9206186/)). | strong |
| 38 | Nothing leaves the device: no accounts, analytics, ads, third-party fonts, CDNs or embedded video (link out instead). Say so in one sentence a child can read, plus a note for parents that the host, GitHub Pages, logs IP addresses for security. | Under COPPA, data that stays on the device and is never sent is not "collected" (FAQ F.5), and every third party that could collect data must be checked (FAQ D.11) ([FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)). ICO standards 4, 7, 8 and 9 cover clear language, high-privacy defaults, collecting as little as possible and not sharing ([ICO standards](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/)). GitHub logs visitors' IP addresses ([GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)). | strong |

### I. Accessibility
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 39 | Never use colour alone: teams, results and zones also get a shape, label or pattern. Avoid red/green pairs. Text contrast is at least 4.5:1; tokens, arrows and zone edges are at least 3:1 against the pitch. | About 1 in 12 boys and men is colour-blind, roughly one child per class ([Colour Blind Awareness](https://www.colourblindawareness.org/colour-blindness/)). WCAG 2.2 criteria [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). BDA: avoid green with red or pink ([BDA 2023](https://www.bumc.bu.edu/jmedday/files/2025/05/Dyslexia-Style-Guide-2023-BDA-Style-Guide-2023.pdf)). | strong |
| 40 | Offer a "Wider spacing" reading option (letter spacing of at least 0.12 em, line height up to 2) instead of a dyslexia font. | Very wide letter spacing improved reading for children with dyslexia straight away, with no training ([Zorzi 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3396504/)). The OpenDyslexic font did not help ([Wery & Diliberto 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233/), [Rello & Baeza-Yates 2013](https://dyslexiahelp.umich.edu/wp-content/uploads/2014/02/good_fonts_for_dyslexia_study.pdf)). BDA: letter spacing of about 35% of the average letter width ([BDA 2023](https://www.bumc.bu.edu/jmedday/files/2025/05/Dyslexia-Style-Guide-2023-BDA-Style-Guide-2023.pdf)). | moderate |
| 41 | Treat reduced motion as a tested contract. Under `prefers-reduced-motion` there is no confetti, shake or camera zoom; replays still run, but without zoom or pan. | WCAG 2.3.3: motion triggered by interaction must be possible to turn off, which protects people with vestibular disorders ([2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)). fotbol already honours the setting; add a regression test. | strong |

### J. Checking with real players
| # | Rule | Evidence and sources | Conf. |
|---|---|---|---|
| 42 | Before shipping a redesigned screen, test it with about 5 players aged 10-11 and about 5 aged 13-14, in separate groups. Measure the time to first drag, and note what they read aloud and what they skip. | NN/g: group participants by maturity; sessions of about 60 min for children up to 12 ([NN/g minors](https://www.nngroup.com/articles/usability-testing-minors/)). Age bands behave very differently ([NN/g children](https://www.nngroup.com/articles/childrens-websites-usability-issues/)). | moderate |

## What to avoid

- **Childish signals:**
  - the word "kid(s)";
  - cartoon mascots and baby talk;
  - "!!!";
  - confetti on every rep;
  - inflated praise ("Incredible!" for a B).
- **Walls of text in a rep:**
  - principle codes (U2, D4) on learner screens;
  - jargon with no picture;
  - letter-spaced ALL-CAPS labels and italics;
  - keyboard help that is always on screen (show it on keyboard focus instead).
- **School-style judgement:**
  - letter grades, especially a red F;
  - "Wrong!";
  - scores that compare the player with others.
- **Social comparison and exposure:**
  - leaderboards, percentiles and public profiles;
  - chat and friend lists.
- **Loss and chance mechanics:**
  - day streaks that reset, streak freezes and "don't break your streak";
  - packs, spins, mystery boxes and random rarity.
- **Engagement bait:**
  - XP for opening the app, finishing or time spent;
  - daily login bonuses;
  - automatic next session;
  - countdown offers, guilt-trip exits and nagging notifications.
- **Front-loaded teaching:**
  - compulsory tours before the first drag;
  - a Help button standing in for a clear design;
  - free Explore mode as a beginner's first stop.
- **Sensory clutter:**
  - background music during Watch and Decide;
  - cues given only by sound;
  - meaning carried by colour alone;
  - text covering the part of the pitch that matters.
- **Data leaks:**
  - third-party fonts, CDNs, analytics and embedded video;
  - free-text name fields.

## Sources

Tags: `[abstract]` = abstract only; `[secondary]` = reported by another source; `[unverified]` = not confirmed at the source. Anything untagged was opened in full, or the relevant page was read.

**Development, reading and user experience**
- Nielsen Norman Group (NN/g) (Sherwin & Nielsen 2019), "Children's UX: usability issues": <https://www.nngroup.com/articles/childrens-websites-usability-issues/>
- NN/g (Liu 2018), "Designing for kids: cognitive considerations": <https://www.nngroup.com/articles/kids-cognition/>
- NN/g (Liu 2018), "Design for kids based on their stage of physical development": <https://www.nngroup.com/articles/children-ux-physical-development/>
- NN/g (Kendrick & Nielsen 2019), "Teenager's UX: designing for teens": <https://www.nngroup.com/articles/usability-of-websites-for-teenagers/>
- NN/g (Kendrick 2019), "Usability testing with minors": <https://www.nngroup.com/articles/usability-testing-minors/>
- ICO Children's Code, Annex B, "Age and developmental stages": <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-b-age-and-developmental-stages/>
- Hasbrouck & Tindal (2017), compiled oral reading fluency norms: <https://files.eric.ed.gov/fulltext/ED594994.pdf>
- Lexile grade-level charts: <https://hub.lexile.com/lexile-grade-level-charts/>
- Home Office design manual, readability: <https://design.homeoffice.gov.uk/accessibility/written-content/readability>
- Gathercole et al. (2004), working memory from 4 to 15 years `[abstract]`: <https://doi.org/10.1037/0012-1649.40.2.177>
- Fortenbaugh et al. (2015), sustained attention across the lifespan `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC4567490/>
- Somerville (2013), the teenage brain and social evaluation `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC3992953/>
- Yeager, Dahl & Dweck (2018), respect and status in adolescence `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC5758430/>
- MTAGIC project (children's touch input): <https://init.cise.ufl.edu/projects-gallery/mobile-touch-and-gesture-interaction-for-children-mtagic-2/>
  - Chen et al. (2020): <https://init.cise.ufl.edu/wp-content/uploads/sites/378/2017/03/chen-et-al-ICMI2020.pdf>
  - The widely quoted miss rates (about 30% at ages 7-10 and 20% at 11-17) are `[unverified]` and not used here.

**Learning science**
- Mayer (2023), "Research-based principles for designing multimedia instruction" (Division 2, American Psychological Association; effect sizes from Mayer 2021): <https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-research-based-principles-for-designing-multimedia-instruction-mayer.pdf>
- Moreno & Mayer (2000), irrelevant sounds and music `[abstract]`: <https://eric.ed.gov/?id=EJ619361>
- Höffler & Leutner (2007), animation vs static pictures `[abstract]`: <https://eric.ed.gov/?id=EJ780451>
- Alfieri et al. (2011), discovery-based instruction `[abstract]`: <https://eric.ed.gov/?id=EJ933606>
- Barbieri et al. (2023), worked examples meta-analysis `[abstract]`: <https://eric.ed.gov/?id=EJ1364058>
- Karpicke, Blunt & Smith (2016), retrieval practice in children `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC4786565/>
- Agarwal, Nunes & Blunt (2021), retrieval practice in classrooms `[abstract]`: <https://eric.ed.gov/?id=EJ1319572>
- Clark, Tanner-Smith & Killingsworth (2016), digital games meta-analysis (read Table 3): <https://pmc.ncbi.nlm.nih.gov/articles/PMC4748544/>
- Wouters et al. (2013), serious games meta-analysis `[abstract]`: <https://eric.ed.gov/?id=EJ1008015>
- Kulik, Kulik & Bangert-Drowns (1990), mastery learning `[abstract]`: <https://eric.ed.gov/?id=EJ415887>
- Andersen et al. (2012), tutorials in games of varying complexity: <https://grail.cs.washington.edu/projects/game-abtesting/chi2012/chi2012.pdf>
- Schroeder, Adesope & Gilbert (2013), pedagogical agents `[abstract]`: <https://eric.ed.gov/?id=EJ1076333>
- Wood et al. (2018), text-to-speech for reading disabilities `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC5494021/>

**Feedback and praise**
- Shute (2008), "Focus on formative feedback" (read Tables 2-4): <https://andymatuschak.org/files/papers/Shute%20-%202008%20-%20Focus%20on%20Formative%20Feedback.pdf>
- Van der Kleij, Feskens & Eggen (2015), feedback in computer-based learning `[abstract]`: <https://eric.ed.gov/?id=EJ1081708>
- Hattie & Timperley (2007), "The power of feedback" `[abstract]`; the claim that feedback about the self is least effective is `[secondary]`: <https://eric.ed.gov/?id=EJ782448>
- Butler (1988), grades vs comments `[abstract]`; the n = 132 detail and the low-achiever caveat are `[secondary]`, from Guskey: <https://eric.ed.gov/?id=EJ380489>
- Guskey (2019), "Grades versus comments" (Education Week): <https://www.edweek.org/education/opinion-grades-versus-comments-what-does-the-research-really-tell-us/2019/06>
- Mueller & Dweck (1998), praise for intelligence `[abstract]`: <https://doi.org/10.1037/0022-3514.75.1.33>
- Brummelman et al. (2014), inflated praise `[abstract]`: <https://doi.org/10.1177/0956797613514251>
- Yeager et al. (2014), wise feedback `[abstract]`: <https://doi.org/10.1037/a0033906>
- Sisk et al. (2018), mindset meta-analyses `[abstract]`: <https://doi.org/10.1177/0956797617739704>
  - See also Yeager et al. (2019) `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC6786290/>

**Motivation and rewards**
- Deci, Koestner & Ryan (1999), rewards and intrinsic motivation `[abstract]`: <https://doi.org/10.1037/0033-2909.125.6.627>
- Patall, Cooper & Robinson (2008), choice meta-analysis `[abstract]`: <https://doi.org/10.1037/0033-2909.134.2.270>
- Cordova & Lepper (1996), contextualization, personalization and choice `[abstract]`: <https://eric.ed.gov/?id=EJ540338>
- Ryan, Rigby & Przybylski (2006), the motivational pull of video games: <https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf>
- Kao (2020), juiciness in an action RPG, n = 3,018 `[secondary]`; abstract not opened: <https://doi.org/10.1016/j.entcom.2020.100359>
- Silverman & Barasch (2022), broken streaks `[abstract]`: <https://doi.org/10.1093/jcr/ucac029>
- Duolingo's delayed sign-up, about 20% more daily users (company claim in an interview): <https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker/>

**Ethics, privacy and safety**
- ICO Children's Code, the 15 standards: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/code-standards/>
- ICO standard 5, detrimental use of data: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/5-detrimental-use-of-data/>
- ICO standard 13, nudge techniques: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/13-nudge-techniques/>
- ICO scope: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code/>
- FTC, "Complying with COPPA: FAQs" (A.3, D.11, F.5): <https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions>
- GitHub Pages, visitor IP logging: <https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages>
- UNICEF Innocenti (2022), *Responsible Innovation in Technology for Children* (RITEC):
  - report: <https://www.unicef.dk/wp-content/uploads/2024/01/ritec_responsible-innovation-in-technology-for-children-digital-technology-play-and-child-well-being.pdf>
  - The report's indicators are not yet validated.
- RITEC Design Toolbox: <https://www.unicef.org/childrightsandbusiness/workstreams/responsible-technology/online-gaming/ritec-design-toolbox>
- RITEC-8 definitions: <https://digitalthrivingplaybook.org/big-idea/designing-for-childrens-well-being-in-digital-play-the-ritec-8-framework/>
- FTC (2022), *Bringing Dark Patterns to Light*: <https://www.ftc.gov/reports/bringing-dark-patterns-light>
- FTC (2022), Epic Games settlement: <https://www.ftc.gov/news-events/news/press-releases/2022/12/fortnite-video-game-maker-epic-games-pay-more-half-billion-dollars-over-ftc-allegations>
- Radesky et al. (2022), manipulative design in children's apps (ages 3-5) `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC9206186/>
- Zendle & Cairns (2018), loot boxes and problem gambling `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC6248934/>

**Accessibility**
- British Dyslexia Association (BDA) Dyslexia Style Guide 2023, read via a mirror copy: <https://www.bumc.bu.edu/jmedday/files/2025/05/Dyslexia-Style-Guide-2023-BDA-Style-Guide-2023.pdf>
  - The official copy returned "access denied" to scripts: <https://cdn.bdadyslexia.org.uk/uploads/documents/Advice/style-guide/BDA-Style-Guide-2023.pdf>
- Rello & Baeza-Yates (2013), "Good fonts for dyslexia": <https://dyslexiahelp.umich.edu/wp-content/uploads/2014/02/good_fonts_for_dyslexia_study.pdf>
- Zorzi et al. (2012), extra-large letter spacing `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC3396504/>
- Wery & Diliberto (2017), OpenDyslexic `[abstract]`: <https://pmc.ncbi.nlm.nih.gov/articles/PMC5629233/>
- Colour Blind Awareness, prevalence: <https://www.colourblindawareness.org/colour-blindness/>
- WCAG 2.2 Understanding pages:
  - [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
  - [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  - [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  - [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  - [2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
  - [2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
  - [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
