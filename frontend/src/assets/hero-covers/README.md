# Temporary Hero Covers

Portrait 2:3 (600×900) cover art used **only** as the offline hero fallback while
the Edulib backend / R2 is unreachable, or when a content row has no usable
`cover_url`.

These are illustrations, not real published book covers. They are intentionally
generic and clearly marked `SAMPUL SEMENTARA` on-file so they can never be
mistaken for production book art. Replace them with real, authorized covers
(or simply let the API populate `cover_url`) before the landing page is
considered content-complete.

The titles/authors here mirror the rows already seeded in `scripts/seed-db.js`
so the composition reads as the real collection concept.

Regenerate (from the frontend directory):

```sh
node scripts/generate-hero-covers.mjs
```

Generated with rsvg-convert at 600×900, background `#f3ece0`.
