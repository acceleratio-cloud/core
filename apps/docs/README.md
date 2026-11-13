# Acceleratio docs

The public documentation site, built with [Fumadocs](https://fumadocs.dev) on
Next.js and exported as static files. Pages are MDX in `content/docs`; their
order is in `content/docs/meta.json`.

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # static site in out/
```

## Ask AI

The Ask AI panel sends questions to `POST /api/chat`, which answers from the
whole docs text (`/llms-full.txt`) through [OpenRouter](https://openrouter.ai).
The endpoint is part of the hosting setup, not of this repository, so
`bun run dev` shows the panel without answers.
