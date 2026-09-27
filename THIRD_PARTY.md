# Third-party material

fotbol's own code is MIT (see `LICENSE`). It includes, adapts or is derived from the following.

## HELIOS Base formation data (MIT)

`data/formations/helios-433.json` is converted from `src/formations-dt/normal-formation.conf` in
[helios-base/helios-base](https://github.com/helios-base/helios-base) (RoboCup Soccer Simulation 2D base team).
The conversion shifts the coordinates to our frame (x + 52.5, y + 34) and renames the roles. Later coach edits are ours.

> MIT License. Copyright (c) 2021 HELIOS Base: A base team for the RoboCup Soccer Simulation.

Note: the repository root is MIT-licensed, while its C++ source files carry GPL/LGPL headers. We use **only the formation
data file**, which has no header, and no C++ code. Akiyama and Noda (2008) describe the Delaunay-triangulation positioning method.

## Delaunator (ISC)

`vendor/delaunator/` is from [mapbox/delaunator](https://github.com/mapbox/delaunator).
> ISC License. Copyright (c) 2021, Mapbox. (See `vendor/delaunator/LICENSE`.)

## robust-predicates (Unlicense)

`vendor/robust-predicates/` is from [mourner/robust-predicates](https://github.com/mourner/robust-predicates), a Delaunator dependency.
> Public domain (Unlicense). (See `vendor/robust-predicates/LICENSE`.)

## Ideas and numbers (no code copied)

- Principle rules and thresholds: see `docs/RESEARCH.md` section 8 for every source (US Youth Soccer ODP manual,
  U.S. Soccer curricula, FUT-SAT, Spielverlagerung, Coaches' Voice, IFAB Laws of the Game, and others). Text is paraphrased.
- Scoring design ideas: Spearman (2017/2018), Fernandez and Bornn (2018), Pelánek (2016) Elo for education.
