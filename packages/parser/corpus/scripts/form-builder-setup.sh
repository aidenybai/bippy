#!/usr/bin/env bash
# The pinned form-builder renders its testimonials with react-tweet 3.2, whose
# `enrichTweet` iterates `entities.hashtags`/`symbols`/`urls` that the public
# react-tweet API no longer returns, so every tweet card throws and the page
# falls into `global-error`. Serves the tweets through a local route that
# fills the missing entity arrays and points the cards at it. Run from the
# clone root after `npm install`.
set -euo pipefail

mkdir -p app/api/tweet/[id]
cat > app/api/tweet/[id]/route.ts <<'ROUTE'
import { NextResponse } from 'next/server'

const UPSTREAM = 'https://react-tweet.vercel.app/api/tweet'
const ENTITY_LISTS = ['hashtags', 'symbols', 'urls', 'user_mentions']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const upstream = await fetch(`${UPSTREAM}/${id}`)
  const body = await upstream.json()
  if (body?.data?.entities) {
    for (const list of ENTITY_LISTS) body.data.entities[list] ??= []
  }
  return NextResponse.json(body, { status: upstream.status })
}
ROUTE

grep -q 'apiUrl=' components/sections/testimonials.tsx ||
  perl -pi -e 's|<ClientTweetCard id=\{tweet\} />|<ClientTweetCard id={tweet} apiUrl={`/api/tweet/\${tweet}`} />|' \
    components/sections/testimonials.tsx
grep -q 'apiUrl=' components/sections/testimonials.tsx
