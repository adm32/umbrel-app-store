# Szikra study material

One folder per subject (`magyar/`, later `tori/`, `matek/`). Each folder has a `subject.json`
(name, icon, colour, units, and `for`: the profile ids who study it, e.g. `["hanna"]`) and one JSON file per topic. Files are compiled into the program,
so after a change run `sh src/szikra/build.sh`. `go test` checks every card.

## A topic file

```json
{
  "unit": "ady", "id": "ady-ars", "order": 1,
  "name": "Ars poetica", "icon": "🎺", "color": "#ff7a3d", "sum": "one line for the tile",
  "links": [{ "title": "...", "url": "https://..." }],
  "learn": [{ "id": "gog1", "title": "...", "p": "gog", "b": ["bullet", "bullet"] }],
  "poems": [{ "id": "gog", "title": "...", "year": "1905", "vol": "...", "memo": true,
              "video": "https://...", "text": "line\nline\n\nnext stanza", "notes": ["..."] }],
  "cards": [ ... ]
}
```

`learn` cards are the short notes shown before the first new card that points to them (`"l"`).
Poem ids must be unique across the subject. A poem with `"memo": true` gets memoriter drills
(line order, gaps, type the missing line) generated from its text; every poem with text also
gets two „Melyik versből való?” cards.

## Card types

| `t` | Fields | Shown as |
|---|---|---|
| `mc` | `q`, `a` (right answer), `x` (2–3 wrong ones) | four buttons |
| `tf` | `q` (a statement), `ok` (true/false) | swipe right = igaz, left = hamis |
| `type` | `q`, `a`, `alt` (other accepted spellings) | typed answer, accents and small typos forgiven |
| `cloze` | `s` with `[answers]` in brackets, `x` (extra words) | tap words into the gaps |
| `order` | `q`, `items` in the right order | tap them into order |
| `match` | `q`, `pairs` (3–5 `[left, right]`) | tap pairs |
| `sort` | `q`, `cats` (two names), `ca`, `cb` (items of each) | swipe each item left or right |
| `flash` | `q`, `a` | flip card, self-graded |

Every card may have `w` (why – shown after answering), `p` (poem id) and `l` (learn note id).
Card ids are made from the question text, so editing a question resets that card's progress.
